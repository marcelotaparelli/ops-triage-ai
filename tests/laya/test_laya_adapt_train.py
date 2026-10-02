"""Target ordering and rejection paths for the isolated training adapter."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import laya_adapt_train as training  # noqa: E402


class TrainingItemTests(unittest.TestCase):
    def setUp(self):
        self.ticket = {"input": {"title": "A title", "description": "A description"},
                       "expected": {"priority": "LOW"}}
        self.question = {"type": "choice", "instructions": "Choose priority",
                         "criteria": {"LOW": "Routine", "MEDIUM": "Operational", "HIGH": "Severe", "CRITICAL": "Danger"}}
        self.config = {"max_len": 512, "head_max_len": 192}

    @patch.object(training, "render_options", return_value=["a", "b", "c", "d"])
    @patch.object(training, "build_sequence", return_value=([1, 2, 3, 4], [0, 1, 2, 3],
                                                           {"options": 4, "options_distinct": 4},
                                                           {"state_tokens_dropped": 0}))
    def test_one_hot_follows_option_order(self, build, _render):
        item = training.prepare_item(None, self.config, self.ticket, "priority", self.question)
        self.assertEqual(item["target"], [1.0, 0.0, 0.0, 0.0])
        self.assertEqual(build.call_args.args[1], {"title": "A title", "description": "A description"})
        self.assertEqual(list(build.call_args.args[2]["crit"]), ["LOW", "MEDIUM", "HIGH", "CRITICAL"])

    def test_invalid_label_rejected_before_tokenization(self):
        self.ticket["expected"]["priority"] = "URGENT"
        with self.assertRaisesRegex(ValueError, "outside question taxonomy"):
            training.prepare_item(None, self.config, self.ticket, "priority", self.question)

    @patch.object(training, "render_options", return_value=["a", "b", "c", "d"])
    @patch.object(training, "build_sequence", return_value=([1, 2, 3, 4], [0, 1, 2, 3],
                                                           {"options": 4, "options_distinct": 4},
                                                           {"state_tokens_dropped": 1}))
    def test_truncated_training_state_rejected(self, _build, _render):
        with self.assertRaisesRegex(ValueError, "truncated"):
            training.prepare_item(None, self.config, self.ticket, "priority", self.question)

    @patch.object(training, "render_options", return_value=["a", "b", "c", "d"])
    @patch.object(training, "build_sequence", return_value=([1, 2, 3, 4], [0, 1, 2, 3],
                                                           {"options": 4, "options_distinct": 3},
                                                           {"state_tokens_dropped": 0}))
    def test_collapsed_options_rejected(self, _build, _render):
        with self.assertRaisesRegex(ValueError, "Collapsed options"):
            training.prepare_item(None, self.config, self.ticket, "priority", self.question)


if __name__ == "__main__":
    unittest.main()
