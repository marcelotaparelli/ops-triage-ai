"""Select one trained epoch using only TRAIN metadata and VALIDATION artifacts."""

from __future__ import annotations

import json
from pathlib import Path

import laya_eval as original

ROOT = Path(__file__).resolve().parents[1]
TRAINING = ROOT / "artifacts/laya-adapt-training.json"
SETTINGS = ROOT / "scripts/laya-adapt-training-config.json"
OUTPUT = ROOT / "artifacts/laya-adapt-selection.json"


def rank(artifact: dict) -> tuple[float, float, float, int]:
    metrics = artifact["analysis"]["metrics"]
    calibration = artifact["analysis"]["calibration"]
    mean_brier = sum(calibration[field]["brier"] for field in ("category", "priority", "risk")) / 3
    return (metrics["exactTupleAccuracy"], metrics["categoryMacroF1"], -mean_brier, -artifact["epoch"])


def select(training: dict, candidates: list[dict], settings: dict) -> dict:
    if training["status"] != "complete" or len(training["epoch_results"]) != settings["epochs"]:
        raise ValueError("Training incomplete")
    if len(candidates) != settings["epochs"] or {candidate["epoch"] for candidate in candidates} != set(range(1, settings["epochs"] + 1)):
        raise ValueError("Missing or duplicate candidate epoch")
    for candidate in candidates:
        if (candidate["experiment"] != "B" or candidate["mode"] != "candidate-validation" or
                candidate["dataset_sha256"] != settings["validation_sha256"] or
                candidate["question_config_sha256"] != settings["question_config_sha256"] or
                candidate["analysis"]["attempts"] != 280 or candidate["analysis"]["valid"] != 280 or
                candidate["analysis"]["failures"]):
            raise ValueError("Invalid candidate validation artifact")
        observed = candidate["lifecycle"]["checkpoint"]["weight_sha256"]
        trained = training["epoch_results"][candidate["epoch"] - 1]["checkpoint"]["weight_sha256"]
        if observed != trained:
            raise ValueError("Candidate weight differs from training checkpoint")
    winner = max(candidates, key=rank)
    return {"protocol": settings["protocol"], "selection_rule": settings["checkpoint_selection"],
            "selected_epoch": winner["epoch"], "selected_weight_sha256": winner["lifecycle"]["checkpoint"]["weight_sha256"],
            "candidate_summary": [{"epoch": candidate["epoch"],
                                   "metrics": candidate["analysis"]["metrics"],
                                   "mean_three_field_brier": -rank(candidate)[2]}
                                  for candidate in sorted(candidates, key=lambda item: item["epoch"])]}


def main() -> None:
    settings = json.loads(SETTINGS.read_text())
    training = json.loads(TRAINING.read_text())
    candidates = [json.loads((ROOT / f"artifacts/laya-adapt-validation-epoch-{epoch}.json").read_text())
                  for epoch in range(1, settings["epochs"] + 1)]
    result = select(training, candidates, settings)
    result["training_artifact_sha256"] = original.sha256(TRAINING)
    result["candidate_artifact_sha256"] = {str(epoch): original.sha256(ROOT / f"artifacts/laya-adapt-validation-epoch-{epoch}.json")
                                            for epoch in range(1, settings["epochs"] + 1)}
    original.write_new_json(OUTPUT, result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
