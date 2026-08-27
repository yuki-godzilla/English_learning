from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import math
import re
import sys
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
import parselmouth
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio


SAMPLE_RATE = 16_000
TOKEN_PATTERN = re.compile(r"[a-z]+(?:'[a-z]+)?")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def sha256_hex(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def extract_expected_text(path: Path | None, explicit_text: str | None) -> str | None:
    if explicit_text and explicit_text.strip():
        return explicit_text.strip()
    if path is None:
        return None

    raw = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".md":
        match = re.search(
            r"^## Standard read-aloud passage\s*$\s*(.+?)(?=^##\s|\Z)",
            raw,
            flags=re.MULTILINE | re.DOTALL,
        )
        if match:
            return " ".join(match.group(1).split())
    return " ".join(raw.split())


def tokens(text: str | None) -> list[str]:
    if not text:
        return []
    normalized = text.lower().replace("’", "'")
    return TOKEN_PATTERN.findall(normalized)


def levenshtein_distance(left: list[str], right: list[str]) -> int:
    if len(left) < len(right):
        left, right = right, left
    previous = list(range(len(right) + 1))
    for left_index, left_value in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_value in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_value != right_value),
                )
            )
        previous = current
    return previous[-1]


def matching_word_count(expected: list[str], observed: list[str]) -> int:
    matcher = difflib.SequenceMatcher(a=expected, b=observed, autojunk=False)
    return sum(block.size for block in matcher.get_matching_blocks())


def dbfs(value: float) -> float | None:
    if value <= 0:
        return None
    return 20.0 * math.log10(value)


def rounded(value: float | None, digits: int = 2) -> float | None:
    return None if value is None or not math.isfinite(value) else round(float(value), digits)


def runs(values: np.ndarray, target: bool) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate(values.tolist()):
        if bool(value) == target and start is None:
            start = index
        elif bool(value) != target and start is not None:
            result.append((start, index))
            start = None
    if start is not None:
        result.append((start, len(values)))
    return result


def smooth_activity(activity: np.ndarray, max_gap_frames: int, min_voice_frames: int) -> np.ndarray:
    smoothed = activity.copy()
    for start, end in runs(smoothed, False):
        if start > 0 and end < len(smoothed) and end - start <= max_gap_frames:
            smoothed[start:end] = True
    for start, end in runs(smoothed, True):
        if end - start < min_voice_frames:
            smoothed[start:end] = False
    return smoothed


def waveform_metrics(audio: np.ndarray) -> dict[str, Any]:
    if audio.size == 0:
        raise ValueError("Decoded audio contains no samples.")

    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
    clipping_ratio = float(np.mean(np.abs(audio) >= 0.995))
    duration = audio.size / SAMPLE_RATE

    frame_length = int(SAMPLE_RATE * 0.020)
    hop_length = int(SAMPLE_RATE * 0.010)
    frame_count = max(1, 1 + max(0, audio.size - frame_length) // hop_length)
    frame_rms = np.empty(frame_count, dtype=np.float64)
    for index in range(frame_count):
        start = index * hop_length
        frame = audio[start : start + frame_length]
        frame_rms[index] = math.sqrt(float(np.mean(np.square(frame, dtype=np.float64))))

    noise_floor = float(np.percentile(frame_rms, 20))
    activity_threshold = max(10 ** (-42 / 20), noise_floor * 3.0)
    activity = smooth_activity(
        frame_rms >= activity_threshold,
        max_gap_frames=int(0.15 / (hop_length / SAMPLE_RATE)),
        min_voice_frames=int(0.10 / (hop_length / SAMPLE_RATE)),
    )
    active_runs = runs(activity, True)
    inactive_runs = runs(activity, False)
    active_seconds = float(np.sum(activity) * hop_length / SAMPLE_RATE)
    leading_silence = active_runs[0][0] * hop_length / SAMPLE_RATE if active_runs else duration
    trailing_silence = (
        max(0.0, duration - active_runs[-1][1] * hop_length / SAMPLE_RATE)
        if active_runs
        else duration
    )
    internal_pauses = [
        (end - start) * hop_length / SAMPLE_RATE
        for start, end in inactive_runs
        if start > 0 and end < len(activity) and (end - start) * hop_length / SAMPLE_RATE >= 0.5
    ]

    quality_flags: list[str] = []
    if duration < 3:
        quality_flags.append("recording_too_short")
    if peak < 10 ** (-25 / 20):
        quality_flags.append("level_too_low")
    if clipping_ratio > 0.001:
        quality_flags.append("possible_clipping")
    if active_seconds / duration < 0.25:
        quality_flags.append("mostly_silence")

    sound = parselmouth.Sound(audio, sampling_frequency=SAMPLE_RATE)
    pitch = sound.to_pitch_ac(time_step=0.01, pitch_floor=75, pitch_ceiling=400)
    frequencies = pitch.selected_array["frequency"]
    frequencies = frequencies[frequencies > 0]
    if frequencies.size:
        pitch_median = float(np.median(frequencies))
        pitch_p10 = float(np.percentile(frequencies, 10))
        pitch_p90 = float(np.percentile(frequencies, 90))
        pitch_range_st = 12 * math.log2(pitch_p90 / pitch_p10) if pitch_p10 > 0 else None
    else:
        pitch_median = None
        pitch_p10 = None
        pitch_p90 = None
        pitch_range_st = None

    return {
        "durationSec": rounded(duration),
        "sampleRateHz": SAMPLE_RATE,
        "peakDbfs": rounded(dbfs(peak)),
        "rmsDbfs": rounded(dbfs(rms)),
        "clippingRatio": rounded(clipping_ratio, 5),
        "activityThresholdDbfs": rounded(dbfs(activity_threshold)),
        "activeSpeechSec": rounded(active_seconds),
        "silenceRatio": rounded(max(0.0, 1.0 - active_seconds / duration), 3),
        "leadingSilenceSec": rounded(leading_silence),
        "trailingSilenceSec": rounded(trailing_silence),
        "internalPauseCountGe500ms": len(internal_pauses),
        "longestInternalPauseSec": rounded(max(internal_pauses) if internal_pauses else 0.0),
        "pitchMedianHz": rounded(pitch_median),
        "pitchP10Hz": rounded(pitch_p10),
        "pitchP90Hz": rounded(pitch_p90),
        "pitchRangeSemitonesP10P90": rounded(pitch_range_st),
        "qualityFlags": quality_flags,
    }


def transcribe(audio_path: Path, model_path: Path) -> dict[str, Any]:
    model = WhisperModel(str(model_path), device="cpu", compute_type="int8")
    segments_iterator, info = model.transcribe(
        str(audio_path),
        language="en",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    segments = list(segments_iterator)
    words: list[dict[str, Any]] = []
    for segment in segments:
        for word in segment.words or []:
            words.append(
                {
                    "word": word.word.strip(),
                    "startSec": rounded(word.start),
                    "endSec": rounded(word.end),
                    "probability": rounded(word.probability, 3),
                }
            )

    transcript = " ".join(segment.text.strip() for segment in segments).strip()
    return {
        "language": info.language,
        "languageProbability": rounded(info.language_probability, 3),
        "transcript": transcript,
        "words": words,
    }


def recognition_evidence(expected_text: str | None, transcription: dict[str, Any]) -> dict[str, Any]:
    expected_tokens = tokens(expected_text)
    observed_tokens = tokens(transcription["transcript"])
    evidence: dict[str, Any] = {
        "expectedWordCount": len(expected_tokens) if expected_tokens else None,
        "recognizedWordCount": len(observed_tokens),
    }
    if expected_tokens:
        distance = levenshtein_distance(expected_tokens, observed_tokens)
        matched = matching_word_count(expected_tokens, observed_tokens)
        evidence.update(
            {
                "matchedWordCount": matched,
                "wordMatchRatio": rounded(matched / len(expected_tokens), 3),
                "wordErrorRate": rounded(distance / len(expected_tokens), 3),
                "note": "ASR-based intelligibility proxy; not a phoneme or pronunciation score.",
            }
        )

    timed_words = [word for word in transcription["words"] if word["startSec"] is not None]
    if len(timed_words) >= 2:
        speaking_span = timed_words[-1]["endSec"] - timed_words[0]["startSec"]
        if speaking_span > 0:
            evidence["recognizedWordsPerMinute"] = rounded(len(timed_words) * 60 / speaking_span, 1)
        gaps = [
            {
                "afterWord": timed_words[index - 1]["word"],
                "beforeWord": timed_words[index]["word"],
                "startSec": timed_words[index - 1]["endSec"],
                "durationSec": rounded(timed_words[index]["startSec"] - timed_words[index - 1]["endSec"]),
            }
            for index in range(1, len(timed_words))
            if timed_words[index]["startSec"] - timed_words[index - 1]["endSec"] >= 0.5
        ]
        evidence["wordGapsGe500ms"] = gaps

    evidence["lowConfidenceReviewCandidates"] = sorted(
        [word for word in timed_words if word["probability"] is not None and word["probability"] < 0.6],
        key=lambda item: item["probability"],
    )[:10]
    return evidence


def markdown_summary(result: dict[str, Any]) -> str:
    waveform = result["waveform"]
    recognition = result["recognition"]
    flags = ", ".join(waveform["qualityFlags"]) or "none"
    return "\n".join(
        [
            "# Local pronunciation evidence",
            "",
            f"- Status: `{result['status']}`",
            f"- Direct audio processed: `{result['directAudioProcessed']}`",
            f"- Duration: {waveform['durationSec']} seconds",
            f"- Recording quality flags: `{flags}`",
            f"- Recognized words per minute: {recognition.get('recognizedWordsPerMinute', 'N/A')}",
            f"- Word match ratio: {recognition.get('wordMatchRatio', 'N/A')}",
            f"- Internal pauses (>= 500 ms): {waveform['internalPauseCountGe500ms']}",
            f"- Pitch range (P10-P90): {waveform['pitchRangeSemitonesP10P90']} semitones",
            "",
            "This evidence can support comments about recording quality, intelligibility, pace, pauses, and pitch movement. It does not by itself justify a precise vowel/consonant, word-stress, linking, or native-likeness score.",
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze a collected pronunciation recording locally.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--expected-file", type=Path)
    parser.add_argument("--expected-text")
    parser.add_argument("--task-kind", choices=["read_aloud", "spontaneous"], default="read_aloud")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path, required=True)
    args = parser.parse_args()

    manifest = read_json(args.manifest.resolve())
    audio_path = Path(manifest["capturedPath"]).resolve()
    if not audio_path.is_file():
        raise FileNotFoundError(f"Collected recording was not found: {audio_path}")
    recorded_hash = str(manifest.get("sha256", "")).upper()
    actual_hash = sha256_hex(audio_path)
    if recorded_hash and recorded_hash != actual_hash:
        raise RuntimeError("The recording hash does not match the collection manifest.")

    model_path = args.model_dir.resolve()
    if not (model_path / "model.bin").is_file():
        raise FileNotFoundError(f"Local speech model is not ready: {model_path}")

    expected_text = extract_expected_text(args.expected_file, args.expected_text)
    audio = decode_audio(str(audio_path), sampling_rate=SAMPLE_RATE)
    waveform = waveform_metrics(audio)
    transcription = transcribe(audio_path, model_path)
    recognition = recognition_evidence(expected_text, transcription)

    result = {
        "schemaVersion": 1,
        "status": "analysis_complete",
        "analysisProfile": "local_enhanced",
        "taskKind": args.task_kind,
        "recordingSha256": actual_hash,
        "directAudioProcessed": True,
        "backend": {
            "speechRecognition": f"faster-whisper {version('faster-whisper')}",
            "acousticAnalysis": f"praat-parselmouth {version('praat-parselmouth')}",
            "mediaDecoder": f"PyAV {version('av')}",
            "modelPath": str(model_path),
            "systemFfmpegRequired": False,
        },
        "waveform": waveform,
        "recognition": recognition,
        "transcript": transcription["transcript"],
        "wordTimings": transcription["words"],
        "evaluationScope": {
            "measured": [
                "recording quality",
                "ASR-based intelligibility proxy",
                "recognized speaking pace",
                "pause timing",
                "pitch movement",
            ],
            "notMeasured": [
                "precise vowel/consonant accuracy",
                "definitive word-stress correctness",
                "definitive linking/reduction correctness",
                "native-likeness",
            ],
            "policy": "Do not create a full pronunciation level from ASR confidence or waveform metrics alone.",
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    args.markdown_output.write_text(markdown_summary(result), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        failure = {
            "schemaVersion": 1,
            "status": "analysis_unavailable",
            "directAudioProcessed": False,
            "reason": str(error),
            "pronunciationResult": "N/A / 音声分析手段なし",
        }
        print(json.dumps(failure, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
