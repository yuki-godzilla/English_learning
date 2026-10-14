"""Local contract checks for the installed experimental GOPT environment."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
import frontend
import inference
import run


class LocalGoptContract(unittest.TestCase):
    def test_pinned_source_and_weights_and_complete_training_vocabulary(self):
        run.verify_assets()

    def test_unsupported_numbers_fail_instead_of_silently_disappearing(self):
        with self.assertRaisesRegex(ValueError, "numeric"):
            frontend.normalize_text("There are 123 samples.")

    def test_documented_numeric_forms_are_spelled_out(self):
        self.assertEqual(
            frontend.normalize_text("Gemini 4 costs $2 with 95% off."),
            [
                "GEMINI",
                "FOUR",
                "COSTS",
                "TWO",
                "DOLLARS",
                "WITH",
                "NINETY",
                "FIVE",
                "PERCENT",
                "OFF",
            ],
        )

    def test_invalid_phone_limit_is_rejected(self):
        for limit in (0, 51):
            with self.assertRaises(ValueError):
                inference.predict(Path("unused"), limit)

    def test_existing_output_cannot_reuse_old_predictions(self):
        with tempfile.TemporaryDirectory(prefix="gopt-stale-") as temp:
            directory = Path(temp)
            (directory / "predictions-limit50.json").write_text("old result")
            with patch.object(
                sys,
                "argv",
                [
                    "run.py",
                    "--audio",
                    "unused.wav",
                    "--reference",
                    "unused.txt",
                    "--output-dir",
                    str(directory),
                ],
            ):
                with self.assertRaisesRegex(ValueError, "mixing old predictions"):
                    run.main()

    def test_alignment_cannot_silently_drop_a_reference_phone(self):
        with tempfile.TemporaryDirectory(prefix="gopt-contract-") as temp:
            directory = Path(temp)
            (directory / "phones-pure.json").write_text(json.dumps({"W": 3}))
            (directory / "expected-phones.json").write_text(
                json.dumps(
                    {
                        "test": [
                            {"phone": "W", "word_index": 0},
                            {"phone": "W", "word_index": 0},
                        ]
                    }
                )
            )
            (directory / "features.txt").write_text(
                "test.0 [ 3 " + " ".join(["1"] * 84) + " ]"
            )
            with self.assertRaisesRegex(ValueError, "no truncation"):
                inference.predict(directory)

    def test_all_silence_produces_no_prediction_and_preserves_source(self):
        with tempfile.TemporaryDirectory(prefix="gopt-silence-") as temp:
            directory = Path(temp)
            audio = directory / "silence.wav"
            with wave.open(str(audio), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(16000)
                handle.writeframes(bytes(3 * 16000 * 2))
            reference = directory / "reference.txt"
            reference.write_text("I said thin.")
            output = directory / "result"
            with (
                patch.object(
                    sys,
                    "argv",
                    [
                        "run.py",
                        "--audio",
                        str(audio),
                        "--reference",
                        str(reference),
                        "--output-dir",
                        str(output),
                    ],
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                run.main()
            result = json.loads((output / "run-summary.json").read_text())
            self.assertEqual(result["status"], "no_audio_passed_silence_gate")
            self.assertIsNone(result["prediction_file"])
            self.assertIsNone(result["learner_grade"])
            self.assertTrue(result["inputs"][0]["source_unchanged"])
            self.assertFalse(list(output.glob("predictions*.json")))

    def test_padding_has_the_original_trained_shape_and_phone_sentinel(self):
        with tempfile.TemporaryDirectory(prefix="gopt-shape-") as temp:
            directory = Path(temp)
            (directory / "phones-pure.json").write_text(json.dumps({"W": 3}))
            (directory / "expected-phones.json").write_text(
                json.dumps(
                    {"test": [{"phone": "W", "word_index": i} for i in range(51)]}
                )
            )
            (directory / "features.txt").write_text(
                "\n".join(
                    f"test.{i} [ 3 " + " ".join(["1"] * 84) + " ]" for i in range(51)
                )
            )
            result = inference.predict(directory, 50)
            self.assertEqual(result["fixed_padded_length"], 50)
            chunks = result["cases"]["test"]["chunks"]
            self.assertEqual([c["phone_count"] for c in chunks], [50, 1])
            self.assertEqual(sum(len(c["phone_accuracy"]) for c in chunks), 51)
            self.assertTrue(
                np.isfinite([p for c in chunks for p in c["phone_accuracy"]]).all()
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
