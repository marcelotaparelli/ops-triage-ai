"""Checkpoint selection must depend only on validation, never held-out rows."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import laya_adapt_select as selection  # noqa: E402


def candidate(epoch, exact, macro_f1, brier):
    return {"experiment": "B", "mode": "candidate-validation", "epoch": epoch,
            "dataset_sha256": "validation", "question_config_sha256": "questions",
            "analysis": {"attempts": 280, "valid": 280, "failures": {},
                         "metrics": {"exactTupleAccuracy": exact, "categoryMacroF1": macro_f1},
                         "calibration": {field: {"brier": brier} for field in ("category", "priority", "risk")}},
            "lifecycle": {"checkpoint": {"weight_sha256": f"weight-{epoch}"}}}


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.settings = {"epochs": 2, "validation_sha256": "validation", "question_config_sha256": "questions",
                         "protocol": "test", "checkpoint_selection": "exact, f1, brier, earliest"}
        self.training = {"status": "complete", "epoch_results": [
            {"checkpoint": {"weight_sha256": "weight-1"}},
            {"checkpoint": {"weight_sha256": "weight-2"}}]}

    def test_highest_exact_wins_before_brier(self):
        result = selection.select(self.training, [candidate(1, .70, .90, .1), candidate(2, .71, .80, .4)], self.settings)
        self.assertEqual(result["selected_epoch"], 2)

    def test_ties_choose_lower_brier_then_earliest(self):
        result = selection.select(self.training, [candidate(1, .70, .90, .2), candidate(2, .70, .90, .1)], self.settings)
        self.assertEqual(result["selected_epoch"], 2)
        result = selection.select(self.training, [candidate(1, .70, .90, .1), candidate(2, .70, .90, .1)], self.settings)
        self.assertEqual(result["selected_epoch"], 1)

    def test_rejects_invalid_validation_or_checkpoint(self):
        first, second = candidate(1, .70, .90, .1), candidate(2, .71, .80, .4)
        first["analysis"]["valid"] = 279
        with self.assertRaisesRegex(ValueError, "Invalid candidate"):
            selection.select(self.training, [first, second], self.settings)
        first["analysis"]["valid"] = 280
        first["lifecycle"]["checkpoint"]["weight_sha256"] = "unrelated"
        with self.assertRaisesRegex(ValueError, "differs"):
            selection.select(self.training, [first, second], self.settings)


if __name__ == "__main__":
    unittest.main()
