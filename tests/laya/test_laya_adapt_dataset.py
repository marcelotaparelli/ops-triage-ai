"""Dataset invariants independent of the frozen held-out benchmark."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import laya_adapt_dataset as dataset  # noqa: E402


class DatasetTests(unittest.TestCase):
    def test_deterministic_disjoint_splits_and_taxonomy(self):
        self.assertEqual(len(dataset.SCENARIOS), 33)
        train = dataset.generate("train", 1120, dataset.SEED)
        validation = dataset.generate("validation", 280, dataset.SEED + 1)
        self.assertEqual(train, dataset.generate("train", 1120, dataset.SEED))
        self.assertEqual(len({row["id"] for row in train + validation}), 1400)
        train_text = {(row["input"]["title"], row["input"]["description"]) for row in train}
        val_text = {(row["input"]["title"], row["input"]["description"]) for row in validation}
        self.assertEqual(len(train_text), len(train))
        self.assertEqual(len(val_text), len(validation))
        self.assertFalse(train_text & val_text)
        for rows in (train, validation):
            self.assertGreater(sum(row["scenario"] >= 24 for row in rows), len(rows) // 8)
            lengths = [len(row["input"]["title"] + " " + row["input"]["description"]) for row in rows]
            self.assertLess(min(lengths), 150)
            self.assertGreater(max(lengths), 400)
            for row in rows:
                expected = row["expected"]
                self.assertEqual(set(expected), {"category", "priority", "risk"})
                self.assertIn(expected["category"], {"INCIDENT", "BUG", "FEATURE_REQUEST", "CONTENT_CHANGE", "SUPPORT", "ACCESS", "OTHER"})
                self.assertIn(expected["priority"], {"LOW", "MEDIUM", "HIGH", "CRITICAL"})
                self.assertIn(expected["risk"], {"LOW", "MEDIUM", "HIGH"})
                self.assertEqual(tuple(expected[field] for field in ("category", "priority", "risk")),
                                 dataset.SCENARIOS[row["scenario"]][:3])

    def test_committed_metadata_matches_regeneration(self):
        metadata = json.loads(dataset.METADATA.read_text())
        self.assertEqual(metadata["seed"], dataset.SEED)
        for split, count in dataset.SIZES.items():
            path = dataset.TRAIN if split == "train" else dataset.VALIDATION
            rows = [json.loads(line) for line in path.read_text().splitlines()]
            self.assertEqual(len(rows), count)
            self.assertEqual(dataset.summary(rows), {key: value for key, value in metadata["splits"][split].items()
                                                     if key not in {"path", "sha256"}})


if __name__ == "__main__":
    unittest.main()
