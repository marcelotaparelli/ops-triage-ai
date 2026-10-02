"""Weight-free contract tests for the evaluation-only Python harness."""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import laya_eval as ev  # noqa: E402


class LayaEvaluationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = ev.config()

    def answer(self, field, choice, confidence=0.8):
        labels = ev.taxonomy(self.config)[field]
        probabilities = {label: (0.8 if label == choice else 0.2 / (len(labels) - 1)) for label in labels}
        # Four-decimal output matches the Laya API.
        probabilities = {label: round(value, 4) for label, value in probabilities.items()}
        return {"type": "choice", "choice": choice, "confidence": confidence,
                "answer_confidence": 0.8, "probabilities": probabilities}

    def result(self):
        return {"answers": {"category": self.answer("category", "SUPPORT"),
                            "priority": self.answer("priority", "LOW"),
                            "risk": self.answer("risk", "LOW")},
                "usage": {"input_tokens": 100, "state_tokens": 20,
                          "state_tokens_dropped": 0, "truncated": False}}

    def test_taxonomy_maps_exactly_to_project_enums(self):
        domain = (ROOT / "src/domain/triage.ts").read_text()
        for field, labels in ev.taxonomy(self.config).items():
            for label in labels:
                self.assertIn(label, domain, field)
        self.assertEqual(ev.taxonomy(self.config)["category"],
                         ("INCIDENT", "BUG", "FEATURE_REQUEST", "CONTENT_CHANGE", "SUPPORT", "ACCESS", "OTHER"))
        self.assertEqual(ev.taxonomy(self.config)["priority"], ("LOW", "MEDIUM", "HIGH", "CRITICAL"))
        self.assertEqual(ev.taxonomy(self.config)["risk"], ("LOW", "MEDIUM", "HIGH"))

    def test_parse_preserves_distribution_and_both_confidences(self):
        parsed = ev.parse_result(self.result(), self.config)
        self.assertEqual(parsed["answers"]["category"]["choice"], "SUPPORT")
        self.assertEqual(parsed["answers"]["category"]["confidence"], 0.8)
        self.assertEqual(parsed["answers"]["category"]["answer_confidence"], 0.8)
        self.assertEqual(set(parsed["answers"]["category"]["probabilities"]),
                         set(ev.taxonomy(self.config)["category"]))
        self.assertAlmostEqual(parsed["answers"]["category"]["margin"], 0.7667)

    def test_rejects_schema_probabilities_and_truncation(self):
        cases = []
        invalid = copy.deepcopy(self.result()); invalid["answers"]["category"]["choice"] = "UNKNOWN"; cases.append(invalid)
        invalid = copy.deepcopy(self.result()); del invalid["answers"]["risk"]; cases.append(invalid)
        invalid = copy.deepcopy(self.result()); invalid["answers"]["risk"]["probabilities"]["LOW"] = 1.1; cases.append(invalid)
        invalid = copy.deepcopy(self.result()); invalid["answers"]["priority"]["probabilities"]["LOW"] = -0.1; cases.append(invalid)
        invalid = copy.deepcopy(self.result()); invalid["answers"]["category"]["answer_confidence"] = 0.7; cases.append(invalid)
        invalid = copy.deepcopy(self.result()); invalid["usage"]["truncated"] = True; cases.append(invalid)
        invalid = copy.deepcopy(self.result()); invalid["usage"]["options"] = {"category": "collapsed"}; cases.append(invalid)
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(ev.InvalidOutput):
                ev.parse_result(candidate, self.config)

    def test_dataset_has_frozen_count_hash_and_labels(self):
        self.assertEqual(ev.sha256(ev.HELDOUT_PATH), ev.BASELINE_DATASET_SHA256)
        self.assertEqual(len(ev.read_dataset(ev.HELDOUT_PATH, self.config)), 70)
        self.assertEqual(len(ev.read_dataset(ev.DEV_PATH, self.config)), 42)

    def test_metrics_count_failures_and_calibration_only_valid_rows(self):
        parsed = ev.parse_result(self.result(), self.config)
        rows = [
            {"id": "correct", "expected": {"category": "SUPPORT", "priority": "LOW", "risk": "LOW"},
             "result": parsed, "latency_ms": 10},
            {"id": "wrong", "expected": {"category": "INCIDENT", "priority": "CRITICAL", "risk": "HIGH"},
             "result": parsed, "latency_ms": 20},
            {"id": "failed", "expected": {"category": "INCIDENT", "priority": "HIGH", "risk": "HIGH"},
             "failure": {"code": "MODEL"}, "latency_ms": 30},
        ]
        analysis = ev.analyze(rows, self.config)
        self.assertEqual(analysis["valid"], 2)
        self.assertEqual(analysis["failures"], {"MODEL": 1})
        self.assertEqual(analysis["metrics"], {
            "categoryAccuracy": 0.3333, "priorityAccuracy": 0.3333, "riskAccuracy": 0.3333,
            "categoryMacroF1": 0.0952, "highCriticalPriorityRecall": 0.0,
            "highRiskRecall": 0.0, "exactTupleAccuracy": 0.3333,
        })
        self.assertEqual(analysis["latency_ms"]["p95"], 30)
        self.assertEqual(analysis["selective"][0]["coverage"], 2 / 3)
        self.assertEqual(analysis["selective"][0]["exactTupleAccuracy"], 0.5)
        self.assertEqual(analysis["selective"][-1]["exactTupleAccuracy"], None)
        self.assertEqual(len(analysis["calibration"]["risk"]["details"]), 2)
        self.assertAlmostEqual(analysis["calibration"]["risk"]["ece"], 0.3)

    def test_artifact_creation_is_exclusive_and_machine_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            ev.write_new_json(path, {"status": "running", "rows": []})
            self.assertEqual(json.loads(path.read_text())["rows"], [])
            with self.assertRaises(FileExistsError):
                ev.write_new_json(path, {"status": "retry"})

    def test_inference_failure_sanitizes_exception_text(self):
        class Broken:
            def predict(self, *_args, **_kwargs):
                raise RuntimeError("secret-token-and-private-path")
        row = {"id": "one", "input": {"title": "x", "description": "y"},
               "expected": {"category": "SUPPORT", "priority": "LOW", "risk": "LOW"}}
        result = ev.infer_one(Broken(), row, self.config)
        self.assertEqual(result["failure"], {"code": "MODEL", "type": "RuntimeError"})
        self.assertNotIn("secret-token", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
