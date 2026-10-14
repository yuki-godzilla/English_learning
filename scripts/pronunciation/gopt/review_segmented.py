"""Offline GOPT phoneme review using full-coverage, task-text audio segments.

Three frontend settings support review candidates; neither agreement nor ASR is
a human pronunciation judgment. All raw evidence stays in private local output.
"""

import argparse
import difflib
import hashlib
import importlib.util
import json
import math
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np

from frontend import AM, ASSETS, Frontend, WORKSPACE, normalize_text
from review import EXCLUDED_WORDS, ctc_full, read
from run import reference_text, verify_assets
from segments import SAMPLE_RATE, _decode, segment_cases

VERSION = "local-gopt-consensus-v1"
ENGINE_VERSION = "segmented-frontend-v2"
SETTINGS = ("audio30-d1", "audio30-d0", "audio40-d1")
TIMING_TOLERANCE_SECONDS = 0.6
CUSTOM_OR_NAMED = EXCLUDED_WORDS | {
    "ANTIGRAVITY",
    "CHROMIUM",
    "AGENTIC",
    "REFACTOR",
    "REFACTORING",
    "CODEBASE",
    "WEBPAGE",
    "WEBPAGES",
    "CYBERSECURITY",
    "ROLLBACKS",
    "FLUIDLY",
    "OPTIMIZATIONS",
    "PRO",
    "ULTRA",
    "PIN",
}
FUNCTION_WORDS_AND_NUMBERS = set(
    """A AN THE AND OR BUT SO AS IF TO OF FOR FROM IN ON AT BY WITH WITHOUT INTO ACROSS THROUGH
IS ARE WAS WERE BE BEEN BEING HAS HAVE HAD CAN COULD SHOULD WOULD WILL MUST MAY MIGHT DO DOES DID
I ME MY WE US OUR YOU YOUR HE HIM HIS SHE HER IT ITS THEY THEM THEIR THIS THAT THESE THOSE
THAN THEN THERE HERE WHO WHICH WHAT WHEN WHERE HOW WHILE ABOUT NOT NO YES ALSO JUST MORE MOST
ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ZERO FIRST SECOND THIRD TWENTY THIRTY FORTY
FIFTY SIXTY SEVENTY EIGHTY NINETY HUNDRED THOUSAND MILLION BILLION NUMBER DOLLARS PERCENT
GPT ASTRA GEMINI ARGON GOOGLE AI API ULTRA PRO ANTIGRAVITY CHROME CHROMIUM VALS ENGLISH OK PIN""".split()
)
MAX_CANDIDATE_SETTING_SPAN = 0.25
MIN_CANDIDATE_PHONE_SECONDS = 0.03
VARIANT_BOUNDARY = "Accepted phoneme/accent variants and weak forms are unverified; this is not a confirmed error or correction recommendation."


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical_digest(text):
    return hashlib.sha256(" ".join(normalize_text(text)).encode("utf-8")).hexdigest()


def pcm16(audio):
    """Same quantization as the preserved-sample segmentation frontend."""
    return np.clip(np.rint(audio.astype(np.float64) * 32768), -32768, 32767).astype(
        "<i2"
    )


def load_sources(cases):
    if not cases or len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Nonempty, unique original recording IDs are required")
    sources = {}
    for case in cases:
        identifier = case["id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", identifier):
            raise ValueError("Unsafe original recording identifier")
        if not normalize_text(case["text"]):
            raise ValueError("Preserved task reference must contain English words")
        path = Path(case["wav"]).resolve()
        digest = sha256(path)
        audio = _decode(path)
        if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
            raise ValueError("Recording must decode to nonempty finite mono audio")
        if digest in {item["sha256"] for item in sources.values()}:
            raise ValueError(
                "Duplicate recording bytes must be deduplicated before review"
            )
        pcm = pcm16(audio)
        sources[identifier] = {
            "path": path,
            "sha256": digest,
            "audio": audio,
            "pcm": pcm,
            "samples": len(audio),
            "duration": len(audio) / SAMPLE_RATE,
            "pcm_sha256": hashlib.sha256(pcm.tobytes()).hexdigest(),
        }
    return sources


def exact_asr_matches(canonical, transcription):
    """ASR locates preserved words. It cannot supply replacement task text."""
    observed, details = [], []
    previous_start, previous_end = -1.0, -1.0
    for item in transcription.get("words", []):
        start, end = item.get("startSec"), item.get("endSec")
        probability = item.get("probability")
        if (
            not all(
                isinstance(value, (int, float)) and math.isfinite(value)
                for value in (start, end, probability)
            )
            or end < start
            or start < 0
        ):
            continue
        if start < previous_start or end < previous_end:
            continue
        previous_start, previous_end = start, end
        tokens = re.findall(
            r"[A-Za-z]+(?:'[A-Za-z]+)?",
            str(item.get("word", "")).replace("’", "'").upper(),
        )
        for index, token in enumerate(tokens):
            observed.append(token)
            details.append(
                {
                    "word": token,
                    "start_sec": start + (end - start) * index / len(tokens),
                    "end_sec": start + (end - start) * (index + 1) / len(tokens),
                    "probability": probability,
                }
            )
    matched = {}
    for block in difflib.SequenceMatcher(
        None, canonical, observed, autojunk=False
    ).get_matching_blocks():
        for offset in range(block.size):
            matched[block.a + offset] = details[block.b + offset]
    return matched


def validate_ctc(value, samples):
    if value.get("covered_samples") != samples or not value.get("phones"):
        raise ValueError("Cached CTC must cover the complete decoded recording")
    for phone in value["phones"]:
        first, last = (
            phone.get("activation_first_sec"),
            phone.get("activation_last_sec"),
        )
        score = phone.get("gop_sa_mean_log_posterior")
        if (
            not all(
                isinstance(v, (int, float)) and math.isfinite(v)
                for v in (first, last, score)
            )
            or first < 0
            or last < first
            or last > samples / SAMPLE_RATE + 0.03
        ):
            raise ValueError("Invalid CTC timing or posterior evidence")


def cached_acoustics(case, source, cache_dir):
    """Reuse sound-only evidence; reuse CTC only for the identical task text."""
    if cache_dir is None:
        return None
    path = Path(cache_dir) / (case["id"] + ".json")
    if not path.exists():
        return None
    cached = read(path)
    if (
        cached.get("id") != case["id"]
        or cached.get("source_sha256") != source["sha256"]
        or cached.get("source_unchanged") is not True
    ):
        raise ValueError(
            "Acoustic cache is not proved against the requested source recording"
        )
    if (
        abs(cached.get("covered_seconds", -1) - source["duration"]) > 0.0001
        or abs(cached.get("quality", {}).get("durationSec", -1) - source["duration"])
        > 0.02
    ):
        raise ValueError("Acoustic cache does not cover the whole source recording")
    transcription = cached.get("transcription")
    if (
        not isinstance(transcription, dict)
        or not isinstance(transcription.get("words"), list)
        or not isinstance(transcription.get("transcript"), str)
    ):
        raise ValueError("Acoustic cache has no original ASR timing evidence")
    # Legacy cache records keep their canonical text in inputs.json.
    inputs = read(Path(cache_dir) / "inputs.json")
    original = next((item for item in inputs if item["id"] == case["id"]), None)
    if original is None:
        raise ValueError("Acoustic cache has no canonical reference provenance")
    same_reference = canonical_digest(original["text"]) == canonical_digest(
        case["text"]
    )
    ctc = cached.get("ctc") if same_reference else None
    if ctc is not None:
        validate_ctc(ctc, source["samples"])
    return {
        "transcription": transcription,
        "quality": cached["quality"],
        "ctc": ctc,
        "cache_source": str(path.resolve()),
        "asr_quality_reused": True,
        "ctc_reused": ctc is not None,
        "ctc_reference_changed": not same_reference,
    }


def acquire_acoustics(cases, sources, directory, cache_dir=None):
    """Acquire ASR/quality before constructing any task-reference audio segment."""
    from review import ctc_backend
    from faster_whisper import WhisperModel

    spec = importlib.util.spec_from_file_location(
        "local_waveform_quality", Path(__file__).parent.parent / "analyze.py"
    )
    quality = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(quality)
    backend, whisper = None, None
    directory.mkdir(parents=True, exist_ok=True)
    evidence = {}
    for case in cases:
        source = sources[case["id"]]
        value = cached_acoustics(case, source, cache_dir)
        if value is None:
            if whisper is None:
                whisper = WhisperModel(
                    str(WORKSPACE / "tmp/pronunciation-models/faster-whisper-small.en"),
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=8,
                    local_files_only=True,
                )
            iterator, _ = whisper.transcribe(
                source["audio"],
                language="en",
                beam_size=5,
                word_timestamps=True,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            transcription = list(iterator)
            captured = {
                "transcript": " ".join(
                    segment.text.strip() for segment in transcription
                ),
                "words": [
                    {
                        "word": word.word.strip(),
                        "startSec": word.start,
                        "endSec": word.end,
                        "probability": word.probability,
                    }
                    for segment in transcription
                    for word in segment.words or []
                ],
            }
            value = {
                "transcription": captured,
                "quality": quality.waveform_metrics(source["audio"]),
                "ctc": None,
                "asr_quality_reused": False,
                "ctc_reused": False,
                "ctc_reference_changed": False,
            }
        if value["ctc"] is None:
            if backend is None:
                backend = ctc_backend.PhoneBackend()
            value["ctc"] = ctc_full(
                backend, source["audio"], " ".join(normalize_text(case["text"]))
            )
        validate_ctc(value["ctc"], source["samples"])
        value.update(
            {
                "id": case["id"],
                "source_sha256": source["sha256"],
                "source_unchanged": True,
                "covered_seconds": source["duration"],
                "covered_samples": source["samples"],
                "canonical_reference_sha256": canonical_digest(case["text"]),
                "canonical_text": case["text"],
                "external_audio_transfer": False,
            }
        )
        evidence[case["id"]] = value
        write_json(directory / (case["id"] + ".json"), value)
        print(
            json.dumps(
                {
                    "acoustics": case["id"],
                    "seconds": source["duration"],
                    "asr_quality_reused": value["asr_quality_reused"],
                    "ctc_reused": value["ctc_reused"],
                }
            ),
            flush=True,
        )
    return evidence


def validate_segments(manifest, cases, expected, sources, max_phones):
    """Verify source hashes, exact PCM coverage and preserved word/phone identity."""
    if (
        manifest.get("sample_rate") != SAMPLE_RATE
        or manifest.get("max_phones") != max_phones
    ):
        raise ValueError("Segment setting differs from the requested audio partition")
    segments = manifest.get("cases", [])
    if not segments or len({item["id"] for item in segments}) != len(segments):
        raise ValueError("Segments must be nonempty and uniquely identified")
    identifiers = {case["id"] for case in cases}
    if {item["original_id"] for item in segments} != identifiers or {
        item["id"] for item in manifest.get("sources", [])
    } != identifiers:
        raise ValueError(
            "Segment cache source IDs differ from the requested recordings"
        )
    proof = {item["id"]: item for item in manifest["sources"]}
    for case in cases:
        identifier = case["id"]
        source = sources[identifier]
        origin = proof[identifier]
        if (
            origin.get("sha256") != source["sha256"]
            or origin.get("source_unchanged") is not True
            or origin.get("all_audio_processed") is not True
            or origin.get("covered_samples") != source["samples"]
            or origin.get("decoded_samples") != source["samples"]
        ):
            raise ValueError(
                "Segment cache is not proved against the complete original recording"
            )
        original_words = normalize_text(case["text"])
        group = sorted(
            (item for item in segments if item["original_id"] == identifier),
            key=lambda item: item["phone_start"],
        )
        phone_cursor, word_cursor, sample_cursor = 0, 0, 0
        for segment in group:
            first, last = segment["phone_start"], segment["phone_end"]
            begin, end = segment["reference_word_start"], segment["reference_word_end"]
            left, right = segment["source_start_sample"], segment["source_end_sample"]
            if (
                any(
                    not isinstance(value, int)
                    for value in (first, last, begin, end, left, right)
                )
                or first != phone_cursor
                or begin != word_cursor
                or left != sample_cursor
                or not first < last <= len(expected[identifier])
                or last - first > max_phones
                or not begin < end <= len(original_words)
                or not left < right <= source["samples"]
            ):
                raise ValueError(
                    "Segment cache has gaps, overlap, truncation or invalid boundaries"
                )
            if normalize_text(segment["text"]) != original_words[begin:end]:
                raise ValueError(
                    "Segment canonical text differs from the preserved task reference"
                )
            wanted = expected[identifier][first:last]
            if segment.get("phone_words") != [
                [phone["phone"] for phone in wanted if phone["word_index"] == index]
                for index in range(begin, end)
            ]:
                raise ValueError(
                    "Segment canonical phones differ from the preserved task reference"
                )
            if [phone["word_index"] for phone in wanted] != [
                index
                for index in range(begin, end)
                for _ in segment["phone_words"][index - begin]
            ]:
                raise ValueError("Segment canonical phone/word ownership changed")
            if (
                abs(segment["source_start_sec"] - left / SAMPLE_RATE) > 1e-9
                or abs(segment["source_end_sec"] - right / SAMPLE_RATE) > 1e-9
            ):
                raise ValueError(
                    "Segment source offsets disagree with integer sample bounds"
                )
            with wave.open(str(segment["wav"]), "rb") as wav:
                if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (
                    1,
                    2,
                    SAMPLE_RATE,
                ):
                    raise ValueError(
                        "Cached segment must be unmodified mono PCM16 at 16 kHz"
                    )
                actual = wav.readframes(wav.getnframes())
            if actual != source["pcm"][left:right].tobytes():
                raise ValueError(
                    "Segment PCM samples differ from the original recording"
                )
            phone_cursor, word_cursor, sample_cursor = last, end, right
        if (phone_cursor, word_cursor, sample_cursor) != (
            len(expected[identifier]),
            len(original_words),
            source["samples"],
        ):
            raise ValueError(
                "Segments do not cover every canonical phone, word and source sample"
            )
        if (
            origin.get("segment_count") != len(group)
            or origin.get("phone_count") != phone_cursor
        ):
            raise ValueError("Segment source summary disagrees with its actual cases")
    return manifest


def obtain_segments(option, cases, expected, sources, evidence, directory, maximum):
    if option is None:
        manifest = segment_cases(
            cases, evidence, expected, directory, max_phones=maximum
        )
    else:
        location = Path(option).resolve()
        location = location / "segments-summary.json" if location.is_dir() else location
        manifest = read(location)
        if read(location.parent / "cases.json") != manifest["cases"]:
            raise ValueError("Segment case file and segment manifest disagree")
    return validate_segments(manifest, cases, expected, sources, maximum)


def prediction_scores(case, count):
    cursor, values = 0, []
    if (
        case.get("phone_count") != count
        or case.get("all_phones_accounted_for") is not True
    ):
        raise ValueError("Native prediction does not account for all canonical phones")
    for chunk in case.get("chunks", []):
        scores = chunk.get("phone_accuracy", [])
        if (
            chunk.get("phone_start") != cursor
            or chunk.get("phone_end") != cursor + len(scores)
            or chunk.get("phone_count") != len(scores)
            or not scores
        ):
            raise ValueError(
                "Native prediction chunks have gaps, overlap or truncation"
            )
        values.extend(scores)
        cursor += len(scores)
    result = np.asarray(values, dtype=float)
    if cursor != count or not np.isfinite(result).all():
        raise ValueError("Native phone predictions must be finite and complete")
    return result


def native_evidence(directory, manifest, expected, sources, dither):
    """Aggregate each segment's local phone indices/times to its original source."""
    directory = Path(directory)
    run = read(directory / "run-summary.json")
    predictions = read(directory / "predictions-limit50.json")
    if (
        run.get("mfcc_dither") != dither
        or predictions.get("mfcc_dither") != dither
        or predictions.get("chunk_phone_limit") != 50
        or run.get("external_audio_transfer") is not False
        or run.get("external_api_used") is not False
    ):
        raise ValueError("Native cache settings or local-only execution proof disagree")
    segments = {item["id"]: item for item in manifest["cases"]}
    inputs = {item["id"]: item for item in run["inputs"]}
    cached = {item["id"]: item for item in read(directory / "cases.json")}
    local_expected = read(directory / "expected-phones.json")
    if not (
        set(segments)
        == set(inputs)
        == set(cached)
        == set(local_expected)
        == set(predictions["cases"])
    ):
        raise ValueError("Native cache has missing, duplicate or extra segment IDs")
    symbols = {
        int(index): re.sub(r"\d", "", re.sub(r"_[BIES]$", "", symbol))
        for symbol, index in (
            line.split() for line in (AM / "phones.txt").read_text().splitlines()
        )
    }
    ctm = {identifier: [] for identifier in segments}
    for line in (directory / "ctm.txt").read_text().splitlines():
        identifier, _, first, length, phone = line.split()
        if identifier not in ctm or int(phone) not in symbols:
            raise ValueError("Native CTM contains unknown segment or phone IDs")
        symbol = symbols[int(phone)]
        if symbol in ("SIL", "SPN", "<eps>"):
            continue
        first, length = float(first), float(length)
        if (
            not math.isfinite(first)
            or not math.isfinite(length)
            or first < 0
            or length < 0
        ):
            raise ValueError("Native CTM contains invalid phone timing")
        ctm[identifier].append((first, first + length, symbol))
    result = {
        identifier: {
            "scores": np.full(len(phones), np.nan),
            "spans": np.full((len(phones), 2), np.nan),
        }
        for identifier, phones in expected.items()
    }
    for identifier, segment in segments.items():
        proof = inputs[identifier]
        if (
            proof.get("source_unchanged") is not True
            or proof.get("silence_gate_passed") is not True
            or proof.get("sha256") != sha256(segment["wav"])
            or proof.get("decoded_samples")
            != segment["source_end_sample"] - segment["source_start_sample"]
        ):
            raise ValueError(
                "Native source hash or complete segment sample count disagrees"
            )
        for key, value in segment.items():
            if key != "wav" and cached[identifier].get(key) != value:
                raise ValueError(
                    "Native segment canonical metadata differs from the requested partition"
                )
        first, last = segment["phone_start"], segment["phone_end"]
        original = segment["original_id"]
        wanted = expected[original][first:last]
        local = local_expected[identifier]
        if len(local) != len(wanted) or any(
            a["phone"] != b["phone"]
            or a["word"] != b["word"]
            or a["word_index"] + segment["reference_word_start"] != b["word_index"]
            for a, b in zip(local, wanted)
        ):
            raise ValueError(
                "Native canonical word/phone sequence differs from original reference"
            )
        if [item[2] for item in ctm[identifier]] != [item["phone"] for item in wanted]:
            raise ValueError(
                "Native CTM phone identity/order differs from canonical sequence"
            )
        spans = np.array([[a, b] for a, b, _ in ctm[identifier]], dtype=float)
        if len(spans) and (
            np.any(np.diff(spans[:, 0]) < -0.001)
            or np.any(spans[1:, 0] < spans[:-1, 1] - 0.011)
        ):
            raise ValueError("Native CTM phone sequence is nonmonotonic")
        spans += segment["source_start_sample"] / SAMPLE_RATE
        result[original]["scores"][first:last] = prediction_scores(
            predictions["cases"][identifier], last - first
        )
        result[original]["spans"][first:last] = spans
    for identifier, item in result.items():
        if (
            not np.isfinite(item["scores"]).all()
            or not np.isfinite(item["spans"]).all()
        ):
            raise ValueError(
                "Native aggregation left an original canonical phone uncovered"
            )
        # Alignment failures are handled by the word timing gate, not converted
        # into low learner scores; PCM coverage is verified independently.
        item["source_boundary_outliers"] = int(
            np.sum(
                (item["spans"][:, 0] < 0)
                | (item["spans"][:, 1] > sources[identifier]["duration"] + 0.03)
            )
        )
    return result


def timing_gate(asr, setting_word_spans, duration):
    if not asr or asr.get("probability", 0) < 0.6:
        return False, "missing_high_confidence_exact_asr_word"
    left, right = asr["start_sec"], asr["end_sec"]
    if not 0 <= left < right <= duration:
        return False, "invalid_exact_asr_word_interval"
    if len(setting_word_spans) != len(SETTINGS):
        return False, "missing_frontend_setting"
    for begin, end in setting_word_spans:
        if (
            not math.isfinite(begin)
            or not math.isfinite(end)
            or not 0 <= begin < end <= duration + 0.03
        ):
            return False, "invalid_native_word_interval"
        if (
            begin < left - TIMING_TOLERANCE_SECONDS
            or end > right + TIMING_TOLERANCE_SECONDS
        ):
            return False, "native_word_outside_exact_asr_window"
        if min(end, right) <= max(begin, left):
            return False, "native_word_has_no_overlap_with_exact_asr_word"
    return True, "all_three_frontends_match_exact_asr_word_time"


def common_words():
    values = set()
    for line in (ASSETS / "cmudict.dict").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith(";;;"):
            values.add(re.sub(r"\(\d+\)$", "", line.split()[0]).upper())
    return values


def select_candidates(expected, settings, transcription, ctc, duration, vocabulary):
    values = np.stack([setting["scores"] for setting in settings])
    low, high = values.min(axis=0), values.max(axis=0)
    canonical = []
    grouped = {}
    for index, phone in enumerate(expected):
        grouped.setdefault(phone["word_index"], []).append(index)
    for word_index in range(len(grouped)):
        canonical.append(expected[grouped[word_index][0]]["word"])
    matched = exact_asr_matches(canonical, transcription)
    centers = np.array(
        [
            (phone["activation_first_sec"] + phone["activation_last_sec"]) / 2
            for phone in ctc["phones"]
        ]
    )
    support_scores = np.array(
        [phone["gop_sa_mean_log_posterior"] for phone in ctc["phones"]]
    )
    quartile = float(np.quantile(support_scores, 0.25))
    good, candidates, rejected, healthy_words, rejected_candidates = [], [], [], [], []
    for word_index, indices in grouped.items():
        word = canonical[word_index]
        spans = [
            (
                float(setting["spans"][indices[0], 0]),
                float(setting["spans"][indices[-1], 1]),
            )
            for setting in settings
        ]
        healthy, reason = timing_gate(matched.get(word_index), spans, duration)
        if healthy:
            healthy_words.append(word_index)
        else:
            rejected.append(
                {
                    "word_index": word_index,
                    "word": word,
                    "reason": reason,
                    "word_spans_by_setting": dict(zip(SETTINGS, spans)),
                }
            )
        ordinary = (
            word in vocabulary
            and word not in CUSTOM_OR_NAMED
            and word not in FUNCTION_WORDS_AND_NUMBERS
            and len(word) >= 4
        )
        if not healthy or not ordinary:
            if healthy and word in FUNCTION_WORDS_AND_NUMBERS:
                rejected_candidates.append(
                    {
                        "word": word,
                        "word_index": word_index,
                        "reason": "function_word_number_or_named_term_excluded",
                    }
                )
            continue
        if len(indices) >= 4 and float(low[indices].min()) >= 1.8:
            # Use the same exact-word acoustic support window independently of
            # native aligner drift. Native timing has already passed all gates.
            support_begin = matched[word_index]["start_sec"] - 0.08
            support_end = matched[word_index]["end_sec"] + 0.08
            nearby = (centers >= support_begin) & (centers <= support_end)
            support = float(support_scores[nearby].mean()) if nearby.any() else None
            stable = (
                float((high[indices] - low[indices]).max())
                <= MAX_CANDIDATE_SETTING_SPAN
            )
            if (
                stable
                and np.sum(nearby) >= 2
                and support is not None
                and support > quartile
            ):
                good.append(
                    {
                        "word": word,
                        "word_index": word_index,
                        "start_sec": spans[0][0],
                        "end_sec": spans[0][1],
                        "phone_count": len(indices),
                        "minimum_across_all_three_settings": float(low[indices].min()),
                        "word_spans_by_setting": dict(zip(SETTINGS, spans)),
                        "maximum_phone_span_across_settings": float(
                            (high[indices] - low[indices]).max()
                        ),
                        "ctc_local_activation_count": int(np.sum(nearby)),
                        "ctc_local_log_posterior": support,
                        "ctc_comparison_quartile": quartile,
                        "ctc_support_window_sec": [support_begin, support_end],
                        "ctc_support_window_basis": "high_confidence_exact_asr_word_plus_minus_0_08_seconds",
                        "phoneme_variants_status": "unverified",
                        "interpretation_boundary": VARIANT_BOUNDARY,
                        "kind": "stable_model_support_not_human_correctness_certification",
                    }
                )
            else:
                reasons = []
                if not stable:
                    reasons.append("phone_setting_span_exceeds_0_25")
                if np.sum(nearby) < 2:
                    reasons.append("fewer_than_two_ctc_activations")
                if support is None or support <= quartile:
                    reasons.append("positive_ctc_support_not_above_lower_quartile")
                rejected_candidates.append(
                    {
                        "word": word,
                        "word_index": word_index,
                        "candidate_kind": "strength",
                        "reasons": reasons,
                    }
                )
        for index in indices:
            if high[index] >= 1.4:
                continue
            reasons = []
            if high[index] - low[index] > MAX_CANDIDATE_SETTING_SPAN:
                reasons.append("phone_setting_span_exceeds_0_25")
            if any(
                setting["spans"][index, 1] - setting["spans"][index, 0]
                < MIN_CANDIDATE_PHONE_SECONDS - 1e-9
                for setting in settings
            ):
                reasons.append("phone_shorter_than_0_03_seconds_in_a_setting")
            begin, end = settings[0]["spans"][index]
            nearby = (centers >= begin - 0.12) & (centers <= end + 0.12)
            support = float(support_scores[nearby].mean()) if nearby.any() else None
            if np.sum(nearby) < 2:
                reasons.append("fewer_than_two_ctc_activations")
            if support is None or support > quartile:
                reasons.append("negative_ctc_support_not_in_lower_quartile")
            if reasons:
                rejected_candidates.append(
                    {
                        "word": word,
                        "word_index": word_index,
                        "phone": expected[index]["phone"],
                        "phone_index": index,
                        "candidate_kind": "low_support",
                        "reasons": reasons,
                    }
                )
            else:
                candidates.append(
                    {
                        "word": word,
                        "phone": expected[index]["phone"],
                        "phone_index": index,
                        "word_index": word_index,
                        "start_sec": float(begin),
                        "end_sec": float(end),
                        "gopt_min": float(low[index]),
                        "gopt_max": float(high[index]),
                        "ctc_local_log_posterior": support,
                        "ctc_comparison_quartile": quartile,
                        "ctc_local_activation_count": int(np.sum(nearby)),
                        "word_spans_by_setting": dict(zip(SETTINGS, spans)),
                        "phoneme_variants_status": "unverified",
                        "interpretation_boundary": VARIANT_BOUNDARY,
                        "kind": "review_candidate_not_confirmed_error",
                    }
                )
    return {
        "stable_strength_candidates": good,
        "review_candidates": sorted(candidates, key=lambda value: value["gopt_max"]),
        "rejected_candidate_locations_private": rejected_candidates,
        "alignment_gate": {
            "reference_word_count": len(canonical),
            "exact_asr_word_matches": len(matched),
            "healthy_word_count_all_three_settings": len(healthy_words),
            "healthy_word_indices": healthy_words,
            "rejected_words": rejected,
            "tolerance_seconds": TIMING_TOLERANCE_SECONDS,
            "all_setting_word_time_gate_required_for_strengths_and_candidates": True,
            "ordinary_word_gate": "CMU dictionary entry, >=4 letters, excluding known names/acronyms/custom technical words; not a frequency claim",
            "function_words_numbers_and_named_terms_excluded": True,
            "maximum_candidate_phone_setting_span": MAX_CANDIDATE_SETTING_SPAN,
            "minimum_candidate_phone_duration_all_settings_seconds": MIN_CANDIDATE_PHONE_SECONDS,
            "minimum_ctc_nearby_activations": 2,
            "phoneme_variants_status": "unverified",
        },
        "gopt_means_by_setting": {
            name: float(values[index].mean()) for index, name in enumerate(SETTINGS)
        },
        "phone_setting_span_median": float(np.median(high - low)),
        "phone_setting_span_max": float((high - low).max()),
        "setting_sensitive_phones_span_gt_0_2": int(np.sum(high - low > 0.2)),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--acoustic-cache", type=Path)
    parser.add_argument(
        "--segments-primary",
        type=Path,
        help="Verified 30-phone audio segment directory/manifest",
    )
    parser.add_argument(
        "--segments-alt",
        type=Path,
        help="Verified 40-phone audio segment directory/manifest",
    )
    parser.add_argument(
        "--gopt-primary",
        type=Path,
        help="Existing audio30/dither1 native run, phone-limit50",
    )
    parser.add_argument(
        "--gopt-dither",
        type=Path,
        help="Existing audio30/dither0 native run, phone-limit50",
    )
    parser.add_argument(
        "--gopt-alt",
        type=Path,
        help="Existing audio40/dither1 native run, phone-limit50",
    )
    args = parser.parse_args()
    if args.cases and (args.audio or args.reference):
        parser.error("Use --cases or --audio with --reference")
    if not args.cases and not (args.audio and args.reference):
        parser.error("Supply --cases or --audio and --reference")
    cases = (
        read(args.cases)
        if args.cases
        else [
            {
                "id": "recording",
                "wav": str(args.audio.resolve()),
                "text": reference_text(args.reference),
            }
        ]
    )
    directory = args.output_dir.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError("Review output directory must be new and empty")
    started = time.perf_counter()
    verify_assets()
    write_json(directory / "inputs.json", cases)
    sources = load_sources(cases)
    acoustics = acquire_acoustics(
        cases, sources, directory / "acoustics", args.acoustic_cache
    )
    expected = Frontend(directory / "canonical-preparation").execute(
        cases, prepare_only=True
    )
    manifests = [
        obtain_segments(
            args.segments_primary,
            cases,
            expected,
            sources,
            acoustics,
            directory / "segments30",
            30,
        ),
        obtain_segments(
            args.segments_alt,
            cases,
            expected,
            sources,
            acoustics,
            directory / "segments40",
            40,
        ),
    ]
    native, native_roots = [], []
    for option, manifest, dither, label in zip(
        (args.gopt_primary, args.gopt_dither, args.gopt_alt),
        (manifests[0], manifests[0], manifests[1]),
        (1, 0, 1),
        SETTINGS,
    ):
        target = option.resolve() if option else directory / ("native-" + label)
        if option is None:
            native_input = directory / (label + "-cases.json")
            write_json(native_input, manifest["cases"])
            subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("run.py")),
                    "--cases",
                    str(native_input),
                    "--output-dir",
                    str(target),
                    "--phone-limit",
                    "50",
                    "--mfcc-dither",
                    str(dither),
                ],
                check=True,
            )
        native.append(native_evidence(target, manifest, expected, sources, dither))
        native_roots.append(str(target))
    vocabulary = common_words()
    results = []
    for case in cases:
        identifier = case["id"]
        source = sources[identifier]
        captured = acoustics[identifier]
        selection = select_candidates(
            expected[identifier],
            [setting[identifier] for setting in native],
            captured["transcription"],
            captured["ctc"],
            source["duration"],
            vocabulary,
        )
        if sha256(source["path"]) != source["sha256"]:
            raise ValueError("Original source recording changed during review")
        result = {
            "id": identifier,
            "version": VERSION,
            "engine_version": ENGINE_VERSION,
            "private_output": True,
            "source_sha256": source["sha256"],
            "source_pcm_sha256": source["pcm_sha256"],
            "source_unchanged": True,
            "duration_seconds": source["duration"],
            "covered_seconds": source["duration"],
            "covered_samples": source["samples"],
            "sample_rate": SAMPLE_RATE,
            "all_source_samples_preserved_in_each_partition": True,
            "task_kind": "read_aloud",
            "phone_count": len(expected[identifier]),
            "canonical_reference_sha256": canonical_digest(case["text"]),
            "canonical_text": case["text"],
            "canonical_phone_reference": expected[identifier],
            **selection,
            "quality": captured["quality"],
            "transcription": captured["transcription"],
            "ctc": captured["ctc"],
            "cache_reuse": {
                key: captured.get(key)
                for key in (
                    "asr_quality_reused",
                    "ctc_reused",
                    "ctc_reference_changed",
                    "cache_source",
                )
            },
            "segment_sources_by_setting": {
                name: next(
                    item for item in manifest["sources"] if item["id"] == identifier
                )
                for name, manifest in zip(("audio30", "audio40"), manifests)
            },
            "external_audio_transfer": False,
            "external_inference_api_used": False,
            "learner_grade": None,
            "holistic_pronunciation_level": None,
            "prosody_assessed": False,
            "limitations": [
                "Candidates are model-supported review locations, not confirmed learner errors.",
                "Exact ASR matches supply timing gates, not sound-correctness judgments.",
                "Interpolated/unhealthy word alignments cannot produce strengths or low candidates.",
                "Three-setting agreement and CTC support do not certify accepted accent variants.",
                "Different passages and practice/evaluation are not a proficiency trend.",
                "No holistic L, stress, rhythm, linking or intonation correctness is assigned.",
            ],
        }
        write_json(directory / (identifier + ".json"), result)
        results.append(result)
        print(
            json.dumps(
                {
                    "recording": identifier,
                    "phones": result["phone_count"],
                    "timing_healthy_words": selection["alignment_gate"][
                        "healthy_word_count_all_three_settings"
                    ],
                    "stable_good_words": len(selection["stable_strength_candidates"]),
                    "review_candidates": len(selection["review_candidates"]),
                }
            ),
            flush=True,
        )
    summary = {
        "version": VERSION,
        "engine_version": ENGINE_VERSION,
        "status": "completed_local_segmented_phoneme_review_not_holistic_rating",
        "private_output": True,
        "external_audio_transfer": False,
        "external_inference_api_used": False,
        "settings": list(SETTINGS),
        "native_run_directories": native_roots,
        "total_recordings": len(results),
        "total_unique_seconds": sum(item["duration_seconds"] for item in results),
        "total_unique_samples": sum(item["covered_samples"] for item in results),
        "all_source_samples_preserved_in_each_partition": True,
        "learner_grade": None,
        "prosody_assessed": False,
        "runtime_seconds": time.perf_counter() - started,
        "recordings": [
            {
                key: value
                for key, value in item.items()
                if key
                not in (
                    "ctc",
                    "transcription",
                    "quality",
                    "canonical_text",
                    "canonical_phone_reference",
                )
            }
            for item in results
        ],
    }
    write_json(directory / "review-summary.json", summary)
    print(
        "Completed private segmented review:",
        len(results),
        "recordings",
        summary["total_unique_seconds"],
        "seconds",
    )


if __name__ == "__main__":
    main()
