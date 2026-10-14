"""Bounded offline regressions for segmented pronunciation evidence gates."""

import copy
import hashlib
import json
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from review_segmented import (
    cached_acoustics,
    exact_asr_matches,
    prediction_scores,
    select_candidates,
    timing_gate,
    validate_segments,
)


class ReviewSegmentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="gopt-review-gates-")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_one_bad_frontend_rejects_strength_and_low_candidate(self):
        expected = [
            {"phone": phone, "word": "LIGHT", "word_index": 0}
            for phone in ("L", "AY", "T", "S")
        ]
        captured = {
            "words": [
                {"word": "light", "startSec": 2.0, "endSec": 3.0, "probability": 0.99}
            ]
        }
        ctc = {
            "phones": [
                {
                    "activation_first_sec": 2.15,
                    "activation_last_sec": 2.2,
                    "gop_sa_mean_log_posterior": -0.1,
                },
                {
                    "activation_first_sec": 2.5,
                    "activation_last_sec": 2.6,
                    "gop_sa_mean_log_posterior": -0.1,
                },
                {
                    "activation_first_sec": 5.0,
                    "activation_last_sec": 5.1,
                    "gop_sa_mean_log_posterior": -4.0,
                },
            ]
        }
        healthy = np.array([[2.05, 2.2], [2.2, 2.5], [2.5, 2.7], [2.7, 2.95]])
        settings = [
            {"scores": np.full(4, 1.9), "spans": healthy.copy()} for _ in range(3)
        ]
        accepted = select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})
        self.assertEqual(len(accepted["stable_strength_candidates"]), 1)
        settings[2]["spans"] += 3
        rejected = select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})
        self.assertEqual(rejected["stable_strength_candidates"], [])
        for setting in settings:
            setting["scores"][:] = 1.0
        rejected = select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})
        self.assertEqual(rejected["review_candidates"], [])
        self.assertEqual(
            rejected["alignment_gate"]["healthy_word_count_all_three_settings"], 0
        )

    def test_low_candidate_needs_three_low_settings_and_ctc_support(self):
        expected = [
            {"phone": phone, "word": "LIGHT", "word_index": 0}
            for phone in ("L", "AY", "T", "S")
        ]
        captured = {
            "words": [
                {"word": "light", "startSec": 2.0, "endSec": 3.0, "probability": 0.99}
            ]
        }
        ctc = {
            "phones": [
                {
                    "activation_first_sec": 2.05,
                    "activation_last_sec": 2.1,
                    "gop_sa_mean_log_posterior": -4.0,
                },
                {
                    "activation_first_sec": 5.0,
                    "activation_last_sec": 5.1,
                    "gop_sa_mean_log_posterior": -0.1,
                },
                {
                    "activation_first_sec": 2.15,
                    "activation_last_sec": 2.2,
                    "gop_sa_mean_log_posterior": -4.0,
                },
            ]
        }
        span = np.array([[2.05, 2.2], [2.2, 2.5], [2.5, 2.7], [2.7, 2.95]])
        settings = [{"scores": np.full(4, 1.0), "spans": span.copy()} for _ in range(3)]
        accepted = select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})
        self.assertTrue(accepted["review_candidates"])
        self.assertEqual(
            accepted["review_candidates"][0]["kind"],
            "review_candidate_not_confirmed_error",
        )
        settings[1]["scores"][:] = 1.6
        self.assertEqual(
            select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})[
                "review_candidates"
            ],
            [],
        )

    def candidate_fixture(self, word="LIGHT", score=1.0):
        expected = [
            {"phone": phone, "word": word, "word_index": 0}
            for phone in ("L", "AY", "T", "S")
        ]
        captured = {
            "words": [
                {
                    "word": word.lower(),
                    "startSec": 2.0,
                    "endSec": 3.0,
                    "probability": 0.99,
                }
            ]
        }
        span = np.array([[2.05, 2.2], [2.2, 2.5], [2.5, 2.7], [2.7, 2.95]])
        settings = [
            {"scores": np.full(4, score), "spans": span.copy()} for _ in range(3)
        ]
        ctc = {
            "phones": [
                {
                    "activation_first_sec": 2.05,
                    "activation_last_sec": 2.1,
                    "gop_sa_mean_log_posterior": -4.0,
                },
                {
                    "activation_first_sec": 2.15,
                    "activation_last_sec": 2.2,
                    "gop_sa_mean_log_posterior": -4.0,
                },
                {
                    "activation_first_sec": 5.0,
                    "activation_last_sec": 5.1,
                    "gop_sa_mean_log_posterior": -0.1,
                },
            ]
        }
        return expected, settings, captured, ctc

    def test_weak_function_word_is_never_a_pronunciation_candidate(self):
        expected, settings, captured, ctc = self.candidate_fixture("YOUR")
        result = select_candidates(expected, settings, captured, ctc, 8.0, {"YOUR"})
        self.assertEqual(result["review_candidates"], [])
        self.assertIn(
            "function_word", result["rejected_candidate_locations_private"][0]["reason"]
        )

    def test_one_frame_and_setting_sensitive_phones_remain_private_rejections(self):
        expected, settings, captured, ctc = self.candidate_fixture()
        # Three predictions can all be low while still being inconsistent.
        settings[2]["scores"][:] = 1.3
        rejected = select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})
        self.assertEqual(rejected["review_candidates"], [])
        self.assertIn(
            "phone_setting_span_exceeds_0_25",
            rejected["rejected_candidate_locations_private"][0]["reasons"],
        )
        for setting in settings:
            setting["scores"][:] = 1.0
            setting["spans"][:, 1] = setting["spans"][:, 0] + 0.01
        rejected = select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})
        self.assertEqual(rejected["review_candidates"], [])
        self.assertIn(
            "phone_shorter_than_0_03_seconds_in_a_setting",
            rejected["rejected_candidate_locations_private"][0]["reasons"],
        )

    def test_strengths_require_two_ctc_activations_and_nonlow_local_support(self):
        expected, settings, captured, ctc = self.candidate_fixture(score=1.9)
        self.assertEqual(
            select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})[
                "stable_strength_candidates"
            ],
            [],
        )

    def test_positive_ctc_window_cannot_follow_native_drift_into_next_word(self):
        expected, settings, captured, ctc = self.candidate_fixture(score=1.9)
        for setting in settings:
            setting["spans"][-1, 1] = 3.5
        ctc["phones"] = [
            {
                "activation_first_sec": time,
                "activation_last_sec": time + 0.01,
                "gop_sa_mean_log_posterior": value,
            }
            for time, value in [
                (2.1, -0.1),
                (2.6, -0.1),
                (3.3, -8.0),
                (3.4, -8.0),
                (5.0, -0.3),
                (5.2, -0.3),
                (5.4, -0.3),
                (5.6, -0.3),
            ]
        ]
        result = select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})
        self.assertEqual(len(result["stable_strength_candidates"]), 1)
        positive = result["stable_strength_candidates"][0]
        self.assertEqual(positive["ctc_local_activation_count"], 2)
        self.assertAlmostEqual(positive["ctc_local_log_posterior"], -0.1)
        self.assertEqual(positive["ctc_support_window_sec"], [1.92, 3.08])
        for phone in ctc["phones"][:2]:
            phone["gop_sa_mean_log_posterior"] = -0.1
        ctc["phones"][-1]["gop_sa_mean_log_posterior"] = -4.0
        supported = select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})
        self.assertEqual(len(supported["stable_strength_candidates"]), 1)
        self.assertEqual(
            supported["stable_strength_candidates"][0]["phoneme_variants_status"],
            "unverified",
        )
        ctc["phones"].pop(0)
        self.assertEqual(
            select_candidates(expected, settings, captured, ctc, 8.0, {"LIGHT"})[
                "stable_strength_candidates"
            ],
            [],
        )

    def test_timing_gate_rejects_nonoverlap_even_inside_tolerance(self):
        asr = {"start_sec": 2.0, "end_sec": 2.2, "probability": 0.9}
        self.assertFalse(timing_gate(asr, [(2.3, 2.5)] * 3, 4.0)[0])
        self.assertFalse(
            timing_gate({**asr, "probability": 0.59}, [(2.0, 2.2)] * 3, 4.0)[0]
        )
        self.assertTrue(timing_gate(asr, [(2.0, 2.2)] * 3, 4.0)[0])

    def test_exact_asr_words_keep_repetitions_and_split_compounds_for_timing(self):
        words = ["LONG", "TERM", "LONG"]
        captured = {
            "words": [
                {
                    "word": "long-term",
                    "startSec": 1.0,
                    "endSec": 2.0,
                    "probability": 0.8,
                },
                {"word": "long", "startSec": 3.0, "endSec": 3.4, "probability": 0.9},
            ]
        }
        matches = exact_asr_matches(words, captured)
        self.assertEqual(matches[0]["end_sec"], 1.5)
        self.assertEqual(matches[1]["start_sec"], 1.5)
        self.assertEqual(matches[2]["start_sec"], 3.0)
        self.assertEqual(words, ["LONG", "TERM", "LONG"])

    def test_cache_reuses_sound_but_not_ctc_when_heading_changes(self):
        case = {
            "id": "source",
            "wav": "private.m4a",
            "text": "Cloud documents. I work.",
        }
        source = {"sha256": "a" * 64, "duration": 4.0, "samples": 64000}
        cache = {
            "id": "source",
            "source_sha256": source["sha256"],
            "source_unchanged": True,
            "covered_seconds": 4.0,
            "quality": {"durationSec": 4.0},
            "transcription": {"transcript": "Cloud documents I work", "words": []},
            "ctc": {
                "covered_samples": 64000,
                "phones": [
                    {
                        "activation_first_sec": 1.0,
                        "activation_last_sec": 1.2,
                        "gop_sa_mean_log_posterior": -2.0,
                    }
                ],
            },
        }
        (self.root / "source.json").write_text(json.dumps(cache), encoding="utf-8")
        (self.root / "inputs.json").write_text(
            json.dumps([{**case, "text": "I work."}]), encoding="utf-8"
        )
        result = cached_acoustics(case, source, self.root)
        self.assertTrue(result["asr_quality_reused"])
        self.assertIsNone(result["ctc"])
        self.assertTrue(result["ctc_reference_changed"])
        (self.root / "inputs.json").write_text(json.dumps([case]), encoding="utf-8")
        self.assertTrue(cached_acoustics(case, source, self.root)["ctc_reused"])
        with self.assertRaisesRegex(ValueError, "source recording"):
            cached_acoustics(case, {**source, "sha256": "b" * 64}, self.root)

    def test_segment_proof_rejects_one_sample_loss_and_reference_substitution(self):
        pcm = np.array([1, 2, 3, -4], dtype="<i2")
        audio_path = self.root / "segment.wav"
        with wave.open(str(audio_path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(pcm.tobytes())
        case = {"id": "source", "wav": str(audio_path), "text": "thin"}
        source = {
            "sha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
            "samples": 4,
            "pcm": pcm,
        }
        expected = {"source": [{"phone": "TH", "word": "THIN", "word_index": 0}]}
        segment = {
            "id": "source-seg0001",
            "wav": str(audio_path),
            "text": "THIN",
            "phone_words": [["TH"]],
            "original_id": "source",
            "phone_start": 0,
            "phone_end": 1,
            "reference_word_start": 0,
            "reference_word_end": 1,
            "source_start_sample": 0,
            "source_end_sample": 4,
            "source_start_sec": 0.0,
            "source_end_sec": 4 / 16000,
        }
        manifest = {
            "sample_rate": 16000,
            "max_phones": 30,
            "cases": [segment],
            "sources": [
                {
                    "id": "source",
                    "sha256": source["sha256"],
                    "source_unchanged": True,
                    "all_audio_processed": True,
                    "covered_samples": 4,
                    "decoded_samples": 4,
                    "segment_count": 1,
                    "phone_count": 1,
                }
            ],
        }
        validate_segments(manifest, [case], expected, {"source": source}, 30)
        with wave.open(str(audio_path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(pcm[:-1].tobytes())
        with self.assertRaisesRegex(ValueError, "PCM samples"):
            validate_segments(manifest, [case], expected, {"source": source}, 30)
        changed = copy.deepcopy(manifest)
        changed["cases"][0]["text"] = "TIN"
        with self.assertRaisesRegex(ValueError, "canonical text"):
            validate_segments(changed, [case], expected, {"source": source}, 30)

    def test_native_prediction_truncation_cannot_be_hidden_by_a_mean(self):
        case = {
            "phone_count": 3,
            "all_phones_accounted_for": True,
            "chunks": [
                {
                    "phone_start": 0,
                    "phone_end": 2,
                    "phone_count": 2,
                    "phone_accuracy": [1.0, 2.0],
                }
            ],
        }
        with self.assertRaisesRegex(ValueError, "complete"):
            prediction_scores(case, 3)


if __name__ == "__main__":
    unittest.main()
