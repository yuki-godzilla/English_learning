"""Diagnostic whole-file comparison; use review_segmented.py for adopted reviews.

Whole-file native alignment can collapse on longer readings. This module's
shared CTC helpers remain useful, but its diagnostic results are not report
assessments and must not be promoted to learner pronunciation findings.
"""

import argparse
import difflib
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

import ctc_backend
from frontend import WORKSPACE, normalize_text
from run import reference_text

ctc_backend.disable_network()
VERSION = "local-gopt-consensus-v1"
EXCLUDED_WORDS = {
    "GEMINI",
    "ARGON",
    "ASTRA",
    "GPT",
    "AI",
    "API",
    "GOOGLE",
    "VALS",
    "CHROME",
    "CHROMIUM'S",
    "ONE",
    "TWO",
    "FOUR",
    "SIX",
    "TEN",
    "THIRTY",
    "FORTY",
    "NINETY",
    "FIVE",
}


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def flat(case):
    return np.array([v for chunk in case["chunks"] for v in chunk["phone_accuracy"]])


def ctc_full(backend, audio, text):
    start = time.perf_counter()
    logs, centers = [], []
    for begin in range(0, len(audio), 160000):
        end = min(begin + 160000, len(audio))
        left, right = max(0, begin - 8000), min(len(audio), end + 8000)
        values = backend.logits(audio[left:right])
        times = (
            left + np.arange(len(values)) * backend.stride + (backend.receptive - 1) / 2
        )
        use = (times >= begin) & (times < end)
        logs.append(values[use])
        centers.extend((times[use] / 16000).tolist())
    logp = np.concatenate(logs)
    names, ids = backend.phonemize(text)
    result = ctc_backend.gop_sa(logp, ids, backend.blank)
    if "phones" not in result:
        raise ValueError("CTC reference could not be aligned")
    for item in result["phones"]:
        item["expected_phone"] = names[item["phone_index"]]
        item["activation_first_sec"] = centers[item["activation_first_frame"]]
        item["activation_last_sec"] = centers[item["activation_last_frame"]]
    result["covered_samples"] = len(audio)
    result["runtime_seconds"] = time.perf_counter() - start
    result["mean_log_posterior"] = float(
        np.mean([p["gop_sa_mean_log_posterior"] for p in result["phones"]])
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--gopt-main", type=Path)
    parser.add_argument("--gopt-sensitivity", type=Path)
    args = parser.parse_args()
    if args.cases:
        cases = read(args.cases)
    elif args.audio and args.reference:
        cases = [
            {
                "id": "recording",
                "wav": str(args.audio.resolve()),
                "text": reference_text(args.reference),
            }
        ]
    else:
        parser.error("Supply --cases or --audio and --reference")
    directory = args.output_dir.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError("Review output directory must be new and empty")
    inputs = directory / "inputs.json"
    inputs.write_text(json.dumps(cases, indent=2), encoding="utf-8")
    roots = []
    for option, dither in [(args.gopt_main, 1), (args.gopt_sensitivity, 0)]:
        target = option.resolve() if option else directory / f"gopt-d{dither}"
        if not option:
            subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("run.py")),
                    "--cases",
                    str(inputs),
                    "--output-dir",
                    str(target),
                    "--phone-limit",
                    "30",
                    "--compare-chunking",
                    "--mfcc-dither",
                    str(dither),
                ],
                check=True,
            )
        summary = read(target / "run-summary.json")
        for case in cases:
            item = next((i for i in summary["inputs"] if i["id"] == case["id"]), None)
            if (
                not item
                or not item["source_unchanged"]
                or item["sha256"]
                != hashlib.sha256(Path(case["wav"]).read_bytes()).hexdigest()
            ):
                raise ValueError(
                    "Cached GOPT source does not match the requested recording"
                )
        cached = {c["id"]: c for c in read(target / "cases.json")}
        if any(cached[c["id"]]["text"] != c["text"] for c in cases):
            raise ValueError(
                "Cached GOPT canonical reference differs from the requested task"
            )
        roots.append(target)
    datasets = [
        read(root / f"predictions-limit{limit}.json")["cases"]
        for root in roots
        for limit in (30, 50)
    ]
    expected = read(roots[0] / "expected-phones.json")
    pure = read(roots[0] / "phones-pure.json")
    symbols = {
        int(v): k
        for k, v in (
            line.split()
            for line in (
                WORKSPACE
                / "tmp/pronunciation-comparison/gopt-assets/librispeech-chain/exp/chain_cleaned/tdnn_1d_sp/phones.txt"
            )
            .read_text()
            .splitlines()
        )
    }
    spans = {c["id"]: [] for c in cases}
    for line in (roots[0] / "ctm.txt").read_text().splitlines():
        key, _, begin, length, phone = line.split()
        sym = re.sub(r"_[BIES]$", "", symbols[int(phone)])
        if sym not in ("SIL", "SPN", "<eps>"):
            spans[key].append((float(begin), float(begin) + float(length)))
    quality_spec = importlib.util.spec_from_file_location(
        "quality", Path(__file__).parent.parent / "analyze.py"
    )
    quality = importlib.util.module_from_spec(quality_spec)
    quality_spec.loader.exec_module(quality)
    backend = ctc_backend.PhoneBackend()
    math_checks = ctc_backend.independent_math_checks()
    whisper = WhisperModel(
        str(WORKSPACE / "tmp/pronunciation-models/faster-whisper-small.en"),
        device="cpu",
        compute_type="int8",
        cpu_threads=8,
        local_files_only=True,
    )
    results = []
    for case in cases:
        key = case["id"]
        source = Path(case["wav"])
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        audio = decode_audio(str(source), sampling_rate=16000)
        iterator, _ = whisper.transcribe(
            audio,
            language="en",
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        segments = list(iterator)
        captured = {
            "transcript": " ".join(s.text.strip() for s in segments),
            "words": [
                {
                    "word": w.word.strip(),
                    "startSec": w.start,
                    "endSec": w.end,
                    "probability": w.probability,
                }
                for s in segments
                for w in s.words or []
            ],
        }
        words = normalize_text(case["text"])
        observed = []
        observed_word = []
        for item in captured["words"]:
            for token in re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", item["word"].upper()):
                observed.append(token)
                observed_word.append(item)
        matched = {}
        for block in difflib.SequenceMatcher(
            a=words, b=observed, autojunk=False
        ).get_matching_blocks():
            for offset in range(block.size):
                matched[block.a + offset] = observed_word[block.b + offset]
        secondary = ctc_full(backend, audio, " ".join(words))
        values = np.stack([flat(d[key]) for d in datasets])
        low = values.min(axis=0)
        high = values.max(axis=0)
        if len(expected[key]) != len(spans[key]) or len(low) != len(expected[key]):
            raise ValueError(
                "Phone boundaries or model outputs do not cover the full canonical sequence"
            )
        ctctimes = np.array(
            [
                (p["activation_first_sec"] + p["activation_last_sec"]) / 2
                for p in secondary["phones"]
            ]
        )
        ctcscores = np.array(
            [p["gop_sa_mean_log_posterior"] for p in secondary["phones"]]
        )
        quartile = float(np.quantile(ctcscores, 0.25))
        good = []
        candidates = []
        seen = set()
        for j, phone in enumerate(expected[key]):
            word = phone["word"]
            wi = phone["word_index"]
            start, end = spans[key][j]
            asr = matched.get(wi)
            if (
                not asr
                or asr["probability"] < 0.6
                or word in EXCLUDED_WORDS
                or len(word) < 4
            ):
                continue
            near = (ctctimes >= start - 0.12) & (ctctimes <= end + 0.12)
            support = float(np.mean(ctcscores[near])) if near.any() else None
            if (
                high[j] < 1.4
                and support is not None
                and support <= quartile
                and start >= asr["startSec"] - 0.6
                and end <= asr["endSec"] + 0.6
            ):
                candidates.append(
                    {
                        "word": word,
                        "phone": phone["phone"],
                        "word_index": wi,
                        "start_sec": start,
                        "end_sec": end,
                        "gopt_min": float(low[j]),
                        "gopt_max": float(high[j]),
                        "ctc_local_log_posterior": support,
                        "kind": "review_candidate_not_confirmed_error",
                    }
                )
            if word not in seen:
                indices = [
                    k for k, p in enumerate(expected[key]) if p["word_index"] == wi
                ]
                if len(indices) >= 4 and float(low[indices].min()) >= 1.8:
                    seen.add(word)
                    good.append(
                        {
                            "word": word,
                            "start_sec": spans[key][indices[0]][0],
                            "end_sec": spans[key][indices[-1]][1],
                            "minimum_across_all_four_settings": float(
                                low[indices].min()
                            ),
                            "kind": "stable_model_support_not_human_correctness_certification",
                        }
                    )
        candidates = sorted(candidates, key=lambda v: v["gopt_max"])
        result = {
            "id": key,
            "version": VERSION,
            "source_sha256": digest,
            "source_unchanged": hashlib.sha256(source.read_bytes()).hexdigest()
            == digest,
            "duration_seconds": len(audio) / 16000,
            "covered_seconds": len(audio) / 16000,
            "task_kind": "read_aloud",
            "phone_count": len(low),
            "gopt_means_by_setting": {
                label: float(values[i].mean())
                for i, label in enumerate(
                    ["d1-limit30", "d1-limit50", "d0-limit30", "d0-limit50"]
                )
            },
            "phone_setting_span_median": float(np.median(high - low)),
            "phone_setting_span_max": float((high - low).max()),
            "setting_sensitive_phones_span_gt_0_2": int(sum(high - low > 0.2)),
            "stable_strength_candidates": good,
            "review_candidates": candidates,
            "quality": quality.waveform_metrics(audio),
            "recognition": quality.recognition_evidence(" ".join(words), captured),
            "transcription": captured,
            "ctc": secondary,
            "limitations": [
                "Candidates are not confirmed errors.",
                "References, accepted variants and full-recording prosody are not certified by model agreement.",
                "Different passages, practice/evaluation and dates are not a proficiency trend.",
            ],
        }
        results.append(result)
        (directory / (key + ".json")).write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            json.dumps(
                {
                    "recording": key,
                    "seconds": result["duration_seconds"],
                    "phones": len(low),
                    "stable_good_words": len(good),
                    "review_candidates": len(candidates),
                    "ctc_seconds": secondary["runtime_seconds"],
                }
            ),
            flush=True,
        )
    summary = {
        "version": VERSION,
        "status": "completed_local_phoneme_review_not_holistic_rating",
        "external_audio_transfer": False,
        "external_inference_api_used": False,
        "math_checks": math_checks,
        "total_recordings": len(results),
        "total_unique_seconds": sum(r["duration_seconds"] for r in results),
        "recordings": [
            {
                k: v
                for k, v in r.items()
                if k not in ("transcription", "ctc", "quality", "recognition")
            }
            for r in results
        ],
    }
    (directory / "review-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        "Completed local review:",
        len(results),
        "recordings",
        summary["total_unique_seconds"],
        "seconds",
    )


if __name__ == "__main__":
    main()
