"""Private, full-coverage audio segments anchored only by exact ASR word matches.

Canonical text/phones always come from the preserved task reference. ASR supplies
timing anchors only; a missing word is interpolated and explicitly flagged.
"""

import argparse
import difflib
import hashlib
import json
import math
import re
import wave
from pathlib import Path

import numpy as np

from frontend import normalize_text

SAMPLE_RATE = 16000


def _canonical_words(case, expected):
    words = normalize_text(case["text"])
    phones = expected[case["id"]]
    if not words or not phones:
        raise ValueError("Preserved canonical words and phones must be nonempty")
    grouped = []
    for index, word in enumerate(words):
        current = [phone for phone in phones if phone["word_index"] == index]
        if not current or any(phone["word"] != word for phone in current):
            raise ValueError(f"Canonical words/phones disagree at {case['id']}/{index}")
        grouped.append({"word": word, "phones": [phone["phone"] for phone in current]})
    if sum(len(word["phones"]) for word in grouped) != len(phones):
        raise ValueError("Canonical phone sequence has missing or extra word indices")
    if [phone for word in grouped for phone in word["phones"]] != [
        phone["phone"] for phone in phones
    ]:
        raise ValueError("Canonical phone order differs from preserved full reference")
    return grouped


def _asr_words(transcription, duration):
    transcription = transcription.get("transcription", transcription)
    values, flags = [], []
    for entry in transcription.get("words", []):
        start = entry.get("startSec", entry.get("start"))
        end = entry.get("endSec", entry.get("end"))
        if (
            not isinstance(start, (int, float))
            or not isinstance(end, (int, float))
            or not math.isfinite(start)
            or not math.isfinite(end)
            or end < start
        ):
            flags.append("invalid_asr_word_time_skipped")
            continue
        if start < 0 or end > duration:
            flags.append("asr_word_time_clipped_to_recording")
        start, end = max(0.0, min(start, duration)), max(0.0, min(end, duration))
        tokens = re.findall(
            r"[A-Za-z]+(?:'[A-Za-z]+)?",
            str(entry.get("word", "")).replace("’", "'").upper(),
        )
        for index, token in enumerate(tokens):
            left = start + (end - start) * index / len(tokens)
            right = start + (end - start) * (index + 1) / len(tokens)
            if values and (left < values[-1]["start"] or right < values[-1]["end"]):
                flags.append("nonmonotonic_asr_word_time_skipped")
                continue
            if right <= left:
                flags.append("zero_duration_asr_word_time")
            if values and left < values[-1]["end"]:
                flags.append("overlapping_asr_word_times")
            values.append({"word": token, "start": left, "end": right})
    return values, flags


def word_timing_plan(case, transcription, expected, duration):
    """Return original word/phone groups plus anchored/interpolated intervals."""
    words = _canonical_words(case, expected)
    observed, flags = _asr_words(transcription, duration)
    matcher = difflib.SequenceMatcher(
        None,
        [word["word"] for word in words],
        [word["word"] for word in observed],
        autojunk=False,
    )
    anchors = {}
    for match in matcher.get_matching_blocks():
        for offset in range(match.size):
            canonical = match.a + offset
            candidate = observed[match.b + offset]
            anchors[canonical] = {
                "start": candidate["start"],
                "end": candidate["end"],
                "anchored": True,
            }
    timings = [anchors.get(index) for index in range(len(words))]
    unsupported = []
    index = 0
    while index < len(words):
        if timings[index] is not None:
            index += 1
            continue
        start = index
        while index < len(words) and timings[index] is None:
            index += 1
        stop = index
        left = timings[start - 1]["end"] if start else 0.0
        right = timings[stop]["start"] if stop < len(words) else duration
        if right < left:
            flags.append("overlapping_anchor_interval")
            left = (timings[start - 1]["start"] + left) / 2 if start else 0.0
            right = (
                (timings[stop]["end"] + right) / 2 if stop < len(words) else duration
            )
        right = max(left, right)
        lengths = [len(words[i]["phones"]) for i in range(start, stop)]
        total = sum(lengths)
        cumulative = 0
        for current, length in zip(range(start, stop), lengths):
            timings[current] = {
                "start": left + (right - left) * cumulative / total,
                "end": left + (right - left) * (cumulative + length) / total,
                "anchored": False,
            }
            cumulative += length
        unsupported.append(
            {
                "word_start": start,
                "word_end": stop,
                "word_count": stop - start,
                "source_start_sec": left,
                "source_end_sec": right,
            }
        )
    if unsupported:
        flags.append("unmatched_reference_words_interpolated")
    if not anchors:
        flags.append("no_exact_word_anchors")
    elif len(anchors) / len(words) < 0.8:
        flags.append("low_exact_word_anchor_coverage")
    first_anchor = min(
        (timing["start"] for timing in anchors.values()), default=duration
    )
    last_anchor = max((timing["end"] for timing in anchors.values()), default=0.0)
    if first_anchor > 5:
        flags.append("long_leading_unanchored_audio")
    if duration - last_anchor > 5:
        flags.append("long_trailing_unanchored_audio")
    if any(
        span["word_count"] > 3 or span["source_end_sec"] - span["source_start_sec"] > 5
        for span in unsupported
    ):
        flags.append("long_interpolated_reference_span")
    return {
        "words": words,
        "timings": timings,
        "anchor_count": len(anchors),
        "reference_anchor_match_ratio": len(anchors) / len(words),
        "unsupported_reference_spans": unsupported,
        "flags": sorted(set(flags)),
        "first_exact_anchor_start_sec": first_anchor if anchors else None,
        "last_exact_anchor_end_sec": last_anchor if anchors else None,
    }


def _decode(path):
    # Reuse exact PCM samples for the prepared 16 kHz inputs when possible.
    if path.suffix.lower() == ".wav":
        with wave.open(str(path), "rb") as wav:
            if (
                wav.getnchannels() == 1
                and wav.getsampwidth() == 2
                and wav.getframerate() == SAMPLE_RATE
            ):
                return (
                    np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(
                        np.float32
                    )
                    / 32768
                )
    from faster_whisper.audio import decode_audio

    return decode_audio(str(path), sampling_rate=SAMPLE_RATE)


def project_boundaries(desired, minimum_lengths, total_samples):
    """Nearest global L2 boundary projection with fixed endpoints/minimum lengths.

    Subtracting cumulative minimum lengths makes the remaining constraints
    monotonic. Pool-adjacent-violators projects all boundaries together rather
    than pushing short intervals into the end of the recording.
    """
    minimum = np.asarray(minimum_lengths, dtype=np.int64)
    proposed = np.asarray(desired, dtype=np.float64)
    if len(proposed) != len(minimum) + 1 or not len(minimum) or np.any(minimum <= 0):
        raise ValueError("Boundary/minimum-length dimensions are invalid")
    if not np.isfinite(proposed).all() or total_samples <= 0:
        raise ValueError("Boundary proposals must be finite and audio nonempty")
    cumulative = np.concatenate(([0], np.cumsum(minimum)))
    remaining = int(total_samples - cumulative[-1])
    if remaining < 0:
        raise ValueError(
            "Recording cannot satisfy minimum audio duration for the preserved reference"
        )
    targets = proposed[1:-1] - cumulative[1:-1]
    blocks = []
    for value in targets:
        blocks.append([float(value), 1])
        while (
            len(blocks) > 1
            and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]
        ):
            right = blocks.pop()
            left = blocks.pop()
            blocks.append([left[0] + right[0], left[1] + right[1]])
    fitted = np.clip(
        [value / weight for value, weight in blocks for _ in range(weight)],
        0,
        remaining,
    )
    slack = np.concatenate(([0], np.rint(fitted).astype(np.int64), [remaining]))
    boundaries = cumulative + slack
    assert boundaries[0] == 0 and boundaries[-1] == total_samples
    assert np.all(np.diff(boundaries) >= minimum)
    return boundaries.tolist()


def segment_cases(
    cases,
    transcriptions,
    expected,
    output_dir,
    max_phones=30,
    min_segment_seconds=0.25,
    min_phone_seconds=0.03,
):
    """Write contiguous private PCM16 files and return a JSON-serializable manifest.

    `transcriptions` maps each original case ID to a transcription or review JSON.
    `expected` is Frontend.execute(..., prepare_only=True)'s canonical phone map.
    The returned `cases` list is accepted directly by the existing GOPT runner.
    """
    if not isinstance(max_phones, int) or not 1 <= max_phones <= 50:
        raise ValueError("max_phones must be an integer between 1 and 50")
    if (
        not math.isfinite(min_segment_seconds)
        or min_segment_seconds < 0.1
        or not math.isfinite(min_phone_seconds)
        or min_phone_seconds <= 0
    ):
        raise ValueError(
            "Minimum segment duration must be >=0.1s and phone duration positive"
        )
    if not cases:
        raise ValueError("At least one preserved recording case is required")
    if len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Original case IDs must be unique")
    directory = Path(output_dir).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError("Segment output directory must be new and empty")
    segments, sources = [], []
    for case in cases:
        identifier = case["id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", identifier):
            raise ValueError("Case IDs must be safe private file identifiers")
        if identifier not in transcriptions:
            raise ValueError(f"Missing ASR timing evidence for {identifier}")
        path = Path(case["wav"])
        source_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        audio = _decode(path)
        if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
            raise ValueError("Audio must decode to nonempty finite mono samples")
        samples = len(audio)
        duration = samples / SAMPLE_RATE
        plan = word_timing_plan(case, transcriptions[identifier], expected, duration)
        words, timings = plan["words"], plan["timings"]
        groups, begin, count = [], 0, 0
        for index, word in enumerate(words):
            length = len(word["phones"])
            if length > max_phones:
                raise ValueError(
                    f"Canonical word exceeds the phone limit: {identifier}/{index}"
                )
            if count and count + length > max_phones:
                groups.append((begin, index))
                begin, count = index, 0
            count += length
        if count:
            groups.append((begin, len(words)))
        group_phone_counts = [
            sum(len(word["phones"]) for word in words[begin:stop])
            for begin, stop in groups
        ]
        minimum_samples = [
            max(
                math.ceil(min_segment_seconds * SAMPLE_RATE),
                math.ceil(phone_count * min_phone_seconds * SAMPLE_RATE),
            )
            for phone_count in group_phone_counts
        ]
        proposed = (
            [0]
            + [
                round(
                    (timings[stop - 1]["end"] + timings[stop]["start"])
                    * SAMPLE_RATE
                    / 2
                )
                for _, stop in groups[:-1]
            ]
            + [samples]
        )
        if any(right <= left for left, right in zip(proposed, proposed[1:])):
            plan["flags"].append("nonmonotonic_proposed_anchor_boundaries")
        if any(
            right - left < required
            for left, right, required in zip(proposed, proposed[1:], minimum_samples)
        ):
            plan["flags"].append("anchor_boundaries_incompatible_with_minimum_audio")
        boundaries = project_boundaries(proposed, minimum_samples, samples)
        shifts = [after - before for before, after in zip(proposed, boundaries)]
        if any(shifts):
            plan["flags"].append("segment_boundaries_globally_reallocated")
        covered, phone_start, case_segments = 0, 0, []
        for index, ((begin, stop), left, right) in enumerate(
            zip(groups, boundaries[:-1], boundaries[1:])
        ):
            segment_id = f"{identifier}-seg{index + 1:04d}"
            destination = directory / f"{segment_id}.wav"
            pcm = np.clip(
                np.rint(audio[left:right].astype(np.float64) * 32768), -32768, 32767
            ).astype("<i2")
            with wave.open(str(destination), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(SAMPLE_RATE)
                wav.writeframes(pcm.tobytes())
            phone_words = [word["phones"] for word in words[begin:stop]]
            phone_end = phone_start + sum(map(len, phone_words))
            match_ratio = sum(timing["anchored"] for timing in timings[begin:stop]) / (
                stop - begin
            )
            flags = []
            if match_ratio < 1:
                flags.append("contains_interpolated_word_times")
            if shifts[index] or shifts[index + 1]:
                flags.append("audio_boundaries_reallocated_for_minimum_duration")
            if index == 0 and "long_leading_unanchored_audio" in plan["flags"]:
                flags.append("long_leading_unanchored_audio")
            if (
                index == len(groups) - 1
                and "long_trailing_unanchored_audio" in plan["flags"]
            ):
                flags.append("long_trailing_unanchored_audio")
            segment = {
                "id": segment_id,
                "wav": str(destination),
                "text": " ".join(word["word"] for word in words[begin:stop]),
                "phone_words": phone_words,
                "original_id": identifier,
                "phone_start": phone_start,
                "phone_end": phone_end,
                "reference_word_start": begin,
                "reference_word_end": stop,
                "source_start_sample": left,
                "source_end_sample": right,
                "source_start_sec": left / SAMPLE_RATE,
                "source_end_sec": right / SAMPLE_RATE,
                "minimum_required_samples": minimum_samples[index],
                "proposed_source_start_sample": proposed[index],
                "proposed_source_end_sample": proposed[index + 1],
                "start_boundary_shift_sec": shifts[index] / SAMPLE_RATE,
                "end_boundary_shift_sec": shifts[index + 1] / SAMPLE_RATE,
                "reference_anchor_match_ratio": match_ratio,
                "flags": flags,
            }
            segments.append(segment)
            case_segments.append(segment)
            covered += len(pcm)
            phone_start = phone_end
        assert covered == samples and phone_start == len(expected[identifier])
        assert [
            phone
            for segment in case_segments
            for phones in segment["phone_words"]
            for phone in phones
        ] == [phone["phone"] for phone in expected[identifier]]
        assert (
            case_segments[0]["source_start_sample"] == 0
            and case_segments[-1]["source_end_sample"] == samples
        )
        assert all(
            a["source_end_sample"] == b["source_start_sample"]
            for a, b in zip(case_segments, case_segments[1:])
        )
        assert all(
            segment["source_end_sample"] - segment["source_start_sample"]
            >= segment["minimum_required_samples"]
            for segment in case_segments
        )
        if hashlib.sha256(path.read_bytes()).hexdigest() != source_hash:
            raise ValueError("Original audio changed during segmentation")
        sources.append(
            {
                "id": identifier,
                "sha256": source_hash,
                "source_unchanged": True,
                "decoded_samples": samples,
                "covered_samples": covered,
                "duration_seconds": duration,
                "coverage_seconds": covered / SAMPLE_RATE,
                "all_audio_processed": True,
                "segment_count": len(case_segments),
                "phone_count": phone_start,
                "anchor_count": plan["anchor_count"],
                "reference_word_count": len(words),
                "reference_anchor_match_ratio": plan["reference_anchor_match_ratio"],
                "minimum_segment_duration_seconds": min(
                    (right - left) / SAMPLE_RATE
                    for left, right in zip(boundaries, boundaries[1:])
                ),
                "reallocated_boundary_count": sum(shift != 0 for shift in shifts),
                "maximum_boundary_shift_seconds": max(map(abs, shifts)) / SAMPLE_RATE,
                "unsupported_reference_spans": plan["unsupported_reference_spans"],
                "first_exact_anchor_start_sec": plan["first_exact_anchor_start_sec"],
                "last_exact_anchor_end_sec": plan["last_exact_anchor_end_sec"],
                "flags": sorted(set(plan["flags"])),
            }
        )
    result = {
        "version": "exact-asr-word-anchor-segments-v2",
        "private_output": True,
        "sample_rate": SAMPLE_RATE,
        "max_phones": max_phones,
        "boundary_projection": "global_L2_isotonic_with_phone_weighted_minimum_durations",
        "min_segment_seconds": min_segment_seconds,
        "min_phone_seconds": min_phone_seconds,
        "reference_origin": "preserved task text and canonical phones; ASR used only for timing",
        "cases": segments,
        "sources": sources,
    }
    (directory / "cases.json").write_text(
        json.dumps(segments, indent=2), encoding="utf-8"
    )
    (directory / "segments-summary.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--transcriptions-dir", type=Path, required=True)
    parser.add_argument("--expected-phones", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-phones", type=int, default=30)
    parser.add_argument("--min-segment-seconds", type=float, default=0.25)
    parser.add_argument("--min-phone-seconds", type=float, default=0.03)
    args = parser.parse_args()
    read = lambda path: json.loads(path.read_text(encoding="utf-8-sig"))
    cases = read(args.cases)
    transcriptions = {
        case["id"]: read(args.transcriptions_dir / f"{case['id']}.json")
        for case in cases
    }
    result = segment_cases(
        cases,
        transcriptions,
        read(args.expected_phones),
        args.output_dir,
        args.max_phones,
        args.min_segment_seconds,
        args.min_phone_seconds,
    )
    print(
        json.dumps(
            {
                "status": "whole_recordings_segmented",
                "segments": len(result["cases"]),
                "source_samples": sum(
                    source["decoded_samples"] for source in result["sources"]
                ),
                "covered_samples": sum(
                    source["covered_samples"] for source in result["sources"]
                ),
                "source_flags": {
                    source["id"]: source["flags"] for source in result["sources"]
                },
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
