"""Offline experimental GOPT runner; writes private evidence, never learning scores."""

import argparse
import hashlib
import json
import math
import re
import time
import wave
from pathlib import Path

import numpy as np
from faster_whisper.audio import decode_audio
from frontend import Frontend, ASSETS, normalize_text
from inference import predict


def reference_text(path):
    value = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".json":
        value = json.loads(value)["reference_text"]
    elif path.suffix.lower() == ".md":
        match = re.search(
            r"^## Standard read-aloud passage\s*$\s*(.+?)(?=^##\s|\Z)",
            value,
            re.M | re.S,
        )
        if match is None:
            raise ValueError(
                "Markdown reference needs the Standard read-aloud passage heading; use plain text otherwise"
            )
        value = match.group(1).strip()
    if not normalize_text(value):
        raise ValueError("Reference contains no supported English words")
    return value


def verify_assets():
    required = {
        "gopt-model.py": "e63a178f5d32221ebc1233a4fe32dc12a092f804360b1782a6159d3185b3be34",
        "gopt-librispeech.pth": "ab07451e51648f9d2455505a51055b20ac4ad7921d771ccc5170ff486a826259",
    }
    for filename, expected in required.items():
        if hashlib.sha256((ASSETS / filename).read_bytes()).hexdigest() != expected:
            raise ValueError(
                f"Unverified GOPT asset: {filename}; rerun local GOPT setup"
            )
    mapping = json.loads((ASSETS / "phoneme-map.json").read_text())["mapping"]
    expected = [
        "W",
        "IY",
        "K",
        "AO",
        "L",
        "IH",
        "T",
        "B",
        "EH",
        "R",
        "Z",
        "OW",
        "TH",
        "F",
        "AY",
        "V",
        "AH",
        "N",
        "UW",
        "S",
        "G",
        "AA",
        "M",
        "P",
        "NG",
        "HH",
        "EY",
        "SH",
        "AE",
        "D",
        "UH",
        "AW",
        "DH",
        "ER",
        "Y",
        "JH",
        "CH",
        "OY",
        "ZH",
    ]
    if mapping != {phone: index for index, phone in enumerate(expected)}:
        raise ValueError(
            "Training phoneme vocabulary does not match the pretrained model"
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument(
        "--cases",
        type=Path,
        help="Explicit private batch of id, wav, text; optional phone_words",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--phone-limit", type=int, default=50, choices=range(1, 51))
    parser.add_argument("--compare-chunking", action="store_true")
    parser.add_argument(
        "--mfcc-dither",
        type=float,
        default=1,
        choices=(0, 1),
        help="0 makes contrasts reproducible; 1 reproduces the upstream MFCC dither setting",
    )
    args = parser.parse_args()
    if args.cases and (args.audio or args.reference):
        parser.error("Use either --cases or --audio with --reference")
    if not args.cases and not (args.audio and args.reference):
        parser.error("--audio and --reference are required together")
    verify_assets()
    started = time.perf_counter()
    directory = args.output_dir.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError(
            "Output directory must be empty; choose a new directory to avoid mixing old predictions with a new run"
        )
    if args.cases:
        cases = json.loads(args.cases.read_text(encoding="utf-8-sig"))
    else:
        cases = [
            {
                "id": "recording",
                "wav": str(args.audio.resolve()),
                "text": reference_text(args.reference),
            }
        ]
    ids = [case["id"] for case in cases]
    if len(set(ids)) != len(ids) or any(
        not re.fullmatch(r"[A-Za-z0-9_-]+", key) for key in ids
    ):
        raise ValueError(
            "Utterance ids must be unique ASCII letters, digits, hyphens or underscores"
        )
    accepted, inputs = [], []
    for case in cases:
        source = Path(case["wav"]).resolve()
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        audio = decode_audio(str(source), sampling_rate=16000)
        if not len(audio) or not np.isfinite(audio).all():
            raise ValueError(f"Empty or invalid waveform: {case['id']}")
        rms = math.sqrt(float(np.mean(audio.astype(np.float64) ** 2)))
        rms_dbfs = 20 * math.log10(max(rms, 1e-12))
        passes = rms_dbfs >= -75
        item = {
            "id": case["id"],
            "source_path": str(source),
            "sha256": digest,
            "duration_seconds": len(audio) / 16000,
            "decoded_samples": len(audio),
            "rms_dbfs": rms_dbfs,
            "silence_gate_passed": passes,
            "gate_scope": "Rejects near-zero signal only; does not establish human speech or pronunciation quality",
        }
        inputs.append(item)
        if not passes:
            item["status"] = "rejected_near_silence_no_pronunciation_prediction"
            continue
        destination = directory / (case["id"] + ".wav")
        if destination == source:
            raise ValueError(
                "Output WAV would overwrite the source; use a separate output directory"
            )
        pcm = (np.clip(audio, -1, 1 - 1 / 32768) * 32768).astype("<i2")
        with wave.open(str(destination), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(16000)
            handle.writeframes(pcm.tobytes())
        accepted.append({**case, "wav": str(destination)})
    predictions = None
    if accepted:
        frontend = Frontend(directory, dither=args.mfcc_dither)
        frontend.execute(accepted)
        predictions = predict(directory, args.phone_limit)
        predictions["mfcc_dither"] = args.mfcc_dither
        predictions["frontend_deviations"][0] = (
            "MFCC dither=0 for repeatable same-audio reference contrasts; upstream default is 1."
            if args.mfcc_dither == 0
            else "MFCC dither=1, upstream setting; dither realization can depend on utterance order."
        )
        (directory / f"predictions-limit{args.phone_limit}.json").write_text(
            json.dumps(predictions, indent=2), encoding="utf-8"
        )
        if args.compare_chunking:
            alternative = 30 if args.phone_limit != 30 else 50
            other = predict(directory, alternative)
            other["mfcc_dither"] = args.mfcc_dither
            other["frontend_deviations"] = predictions["frontend_deviations"]
            (directory / f"predictions-limit{alternative}.json").write_text(
                json.dumps(other, indent=2), encoding="utf-8"
            )
    for item in inputs:
        item["source_unchanged"] = (
            hashlib.sha256(Path(item["source_path"]).read_bytes()).hexdigest()
            == item["sha256"]
        )
        if not item["source_unchanged"]:
            raise ValueError("Source recording changed during processing")
    result = {
        "status": "local_gopt_experiment_complete"
        if accepted
        else "no_audio_passed_silence_gate",
        "external_audio_transfer": False,
        "external_api_used": False,
        "inputs": inputs,
        "processed_whole_recordings": bool(accepted),
        "whole_recording_coverage_seconds": sum(
            x["duration_seconds"] for x in inputs if x["silence_gate_passed"]
        ),
        "runtime_seconds_including_decode_and_model_load": time.perf_counter()
        - started,
        "learner_grade": None,
        "learning_records_updated": False,
        "mfcc_dither": args.mfcc_dither,
        "prediction_file": f"predictions-limit{args.phone_limit}.json"
        if predictions
        else None,
        "limits": [
            "Experimental model outputs require reference and alignment review.",
            "Long recordings are covered completely; pauses/silences are processed by Kaldi but excluded from GOPT phone sequences.",
            "Chunk-averaged fluency/prosody outputs cannot measure full-recording pacing or intonation correctness.",
        ],
    }
    (directory / "run-summary.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
