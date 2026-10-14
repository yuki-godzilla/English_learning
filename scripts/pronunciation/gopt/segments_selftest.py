"""Offline regression checks for canonical-reference audio segmentation."""

import json
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from frontend import AM, Frontend
from segments import project_boundaries, segment_cases, word_timing_plan


def expected_for(identifier, words):
    return {
        identifier: [
            {"word": word, "word_index": index, "phone": phone, "pure_id": 3}
            for index, (word, phones) in enumerate(words)
            for phone in phones
        ]
    }


class SegmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gopt-segments-")
        self.root = Path(self.temp.name)
        self.source = self.root / "source.wav"
        self.pcm = ((np.arange(80000, dtype=np.int32) * 13 % 40000) - 20000).astype(
            "<i2"
        )
        with wave.open(str(self.source), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(self.pcm.tobytes())
        self.case = {
            "id": "case",
            "wav": str(self.source),
            "text": "I said thin and light.",
        }
        self.words = [
            ("I", ["AY"]),
            ("SAID", ["S", "EH", "D"]),
            ("THIN", ["TH", "IH", "N"]),
            ("AND", ["AE", "N", "D"]),
            ("LIGHT", ["L", "AY", "T"]),
        ]
        self.expected = expected_for("case", self.words)
        self.transcript = {
            "words": [
                {
                    "word": word,
                    "startSec": 0.25 + index * 0.8,
                    "endSec": 0.8 + index * 0.8,
                }
                for index, (word, _) in enumerate(self.words)
            ]
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_pcm_samples_phone_order_and_source_are_preserved_exactly(self):
        original = self.source.read_bytes()
        result = segment_cases(
            [self.case],
            {"case": self.transcript},
            self.expected,
            self.root / "segments",
            max_phones=4,
        )
        combined = []
        for segment in result["cases"]:
            self.assertLessEqual(sum(map(len, segment["phone_words"])), 4)
            with wave.open(segment["wav"], "rb") as wav:
                self.assertEqual(
                    (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()),
                    (1, 2, 16000),
                )
                combined.append(wav.readframes(wav.getnframes()))
        self.assertEqual(b"".join(combined), self.pcm.tobytes())
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(result["sources"][0]["covered_samples"], len(self.pcm))
        self.assertEqual(result["sources"][0]["reference_anchor_match_ratio"], 1)
        self.assertEqual(result["cases"][-1]["phone_end"], len(self.expected["case"]))
        self.assertTrue((self.root / "segments/cases.json").exists())

    def test_asr_mismatch_cannot_change_task_text_or_canonical_phones(self):
        self.transcript["words"][2]["word"] = "tin"
        result = segment_cases(
            [self.case],
            {"case": {"transcription": self.transcript}},
            self.expected,
            self.root / "segments",
            4,
        )
        self.assertEqual(
            " ".join(segment["text"] for segment in result["cases"]),
            "I SAID THIN AND LIGHT",
        )
        self.assertEqual(result["sources"][0]["reference_anchor_match_ratio"], 0.8)
        self.assertIn(
            "unmatched_reference_words_interpolated", result["sources"][0]["flags"]
        )
        thin = next(segment for segment in result["cases"] if segment["text"] == "THIN")
        self.assertEqual(thin["phone_words"], [["TH", "IH", "N"]])
        self.assertIn("contains_interpolated_word_times", thin["flags"])

    def test_missing_anchors_are_flagged_and_full_recording_stays_covered(self):
        result = segment_cases(
            [self.case],
            {"case": {"words": []}},
            self.expected,
            self.root / "segments",
            4,
        )
        self.assertIn("no_exact_word_anchors", result["sources"][0]["flags"])
        self.assertEqual(result["sources"][0]["covered_samples"], 80000)
        self.assertEqual(result["cases"][0]["source_start_sample"], 0)
        self.assertEqual(result["cases"][-1]["source_end_sample"], 80000)

    def test_long_leading_audio_and_unmatched_spans_are_visible(self):
        transcription = {"words": [{"word": "LIGHT", "startSec": 8, "endSec": 9}]}
        plan = word_timing_plan(self.case, transcription, self.expected, 12)
        self.assertIn("long_leading_unanchored_audio", plan["flags"])
        self.assertIn("long_interpolated_reference_span", plan["flags"])
        self.assertEqual(plan["unsupported_reference_spans"][0]["word_count"], 4)

    def test_unsupported_long_words_or_mismatched_reference_fail_before_scoring(self):
        with self.assertRaisesRegex(ValueError, "exceeds the phone limit"):
            segment_cases(
                [self.case],
                {"case": self.transcript},
                self.expected,
                self.root / "segments",
                2,
            )
        self.expected["case"][0]["word"] = "WRONG"
        with self.assertRaisesRegex(ValueError, "Canonical words/phones disagree"):
            segment_cases(
                [self.case],
                {"case": self.transcript},
                self.expected,
                self.root / "segments2",
                4,
            )

    def test_existing_output_is_rejected_to_prevent_stale_segments(self):
        directory = self.root / "segments"
        directory.mkdir()
        (directory / "old.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "new and empty"):
            segment_cases(
                [self.case], {"case": self.transcript}, self.expected, directory, 4
            )

    def test_global_projection_finds_joint_solution_for_reversed_proposals(self):
        self.assertEqual(
            project_boundaries([0, 900, 100, 1000], [100, 100, 100], 1000),
            [0, 450, 550, 1000],
        )
        with self.assertRaisesRegex(
            ValueError, "cannot satisfy minimum audio duration"
        ):
            project_boundaries([0, 20, 30], [20, 20], 30)

    def test_overlapping_zero_duration_anchors_cannot_create_a_one_sample_segment(self):
        transcription = {
            "words": [
                {"word": word, "startSec": 3, "endSec": 3} for word, _ in self.words
            ]
        }
        result = segment_cases(
            [self.case],
            {"case": transcription},
            self.expected,
            self.root / "segments",
            4,
        )
        combined = []
        for segment in result["cases"]:
            length = segment["source_end_sample"] - segment["source_start_sample"]
            self.assertGreaterEqual(length, segment["minimum_required_samples"])
            self.assertGreaterEqual(length, 4000)
            with wave.open(segment["wav"], "rb") as wav:
                combined.append(wav.readframes(wav.getnframes()))
        self.assertEqual(b"".join(combined), self.pcm.tobytes())
        self.assertIn("zero_duration_asr_word_time", result["sources"][0]["flags"])
        self.assertIn(
            "segment_boundaries_globally_reallocated", result["sources"][0]["flags"]
        )
        self.assertEqual(result["cases"][-1]["phone_end"], len(self.expected["case"]))

    @unittest.skipUnless(
        (AM / "phones.txt").exists(), "Local Kaldi model not installed"
    )
    def test_prepare_only_builds_reference_without_invoking_any_kaldi_executable(self):
        frontend = Frontend(self.root / "prepare")
        frontend.run = lambda *args: self.fail(
            "prepare_only invoked an acoustic executable"
        )
        expected = frontend.execute([self.case], prepare_only=True)
        self.assertTrue(expected["case"])
        self.assertTrue((frontend.dir / "expected-phones.json").exists())
        self.assertFalse((frontend.dir / "mfcc.ark").exists())


if __name__ == "__main__":
    unittest.main()
