"""Freeze 2 and single-run held-out harness for a selected local Laya checkpoint.

Quality parsing/metrics reuse the unchanged Experiment A implementation. This
file never modifies its artifacts or the application runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import subprocess
import time
from pathlib import Path

import laya
import torch

import laya_eval as original

ROOT = Path(__file__).resolve().parents[1]
TRAINING_CONFIG = ROOT / "scripts/laya-adapt-training-config.json"
SELECTION = ROOT / "artifacts/laya-adapt-selection.json"
TRAINING = ROOT / "artifacts/laya-adapt-training.json"
BASE_VALIDATION = ROOT / "artifacts/laya-adapt-base-validation.json"
SELECTED_TRAIN = ROOT / "artifacts/laya-adapt-selected-train.json"
FREEZE = ROOT / "artifacts/laya-adapt-freeze.json"
RESULT = ROOT / "artifacts/laya-adapt-held-out.json"
JOURNAL = ROOT / "artifacts/laya-adapt-held-out-attempts.jsonl"
CHECKPOINT_DIR = ROOT / ".cache/laya-adapt-selected"
SOURCES = ("scripts/laya_adapt_dataset.py", "scripts/laya_adapt_train.py", "scripts/laya_adapt_eval.py",
           "scripts/laya_adapt_select.py", "scripts/laya_adapt_heldout.py",
           "scripts/laya-adapt-training-config.json", "scripts/laya_eval.py", "scripts/laya-config.json")


def source_hash() -> str:
    import hashlib
    digest = hashlib.sha256()
    for relative in SOURCES:
        digest.update(relative.encode() + b"\n")
        digest.update((ROOT / relative).read_bytes() + b"\n")
    return digest.hexdigest()


def expected_files() -> dict[str, Path]:
    result = {"training": TRAINING, "base_validation": BASE_VALIDATION,
              "selection": SELECTION, "selected_train": SELECTED_TRAIN}
    settings = json.loads(TRAINING_CONFIG.read_text())
    for epoch in range(1, settings["epochs"] + 1):
        result[f"validation_epoch_{epoch}"] = ROOT / f"artifacts/laya-adapt-validation-epoch-{epoch}.json"
    return result


def require_prepared(checkpoint_dir: Path) -> tuple[dict, dict, dict]:
    settings = json.loads(TRAINING_CONFIG.read_text())
    selection = json.loads(SELECTION.read_text())
    training = json.loads(TRAINING.read_text())
    if original.sha256(original.HELDOUT_PATH) != original.BASELINE_DATASET_SHA256:
        raise RuntimeError("Frozen held-out hash changed")
    if original.sha256(original.CONFIG_PATH) != settings["question_config_sha256"]:
        raise RuntimeError("Question configuration changed")
    if original.sha256(ROOT / "datasets/laya-adapt-train.jsonl") != settings["train_sha256"] or \
            original.sha256(ROOT / "datasets/laya-adapt-validation.jsonl") != settings["validation_sha256"]:
        raise RuntimeError("TRAIN/VALIDATION hash changed")
    if training["status"] != "complete":
        raise RuntimeError("Training is incomplete")
    if selection["selected_weight_sha256"] != original.sha256(checkpoint_dir / "model.safetensors"):
        raise RuntimeError("Selected checkpoint weight hash mismatch")
    selected_train = json.loads(SELECTED_TRAIN.read_text())
    if selected_train["analysis"]["attempts"] != 1120 or selected_train["analysis"]["valid"] != 1120:
        raise RuntimeError("Selected checkpoint TRAIN evaluation incomplete")
    for path in expected_files().values():
        if not path.exists():
            raise RuntimeError(f"Missing required artifact: {path.name}")
    return settings, selection, training


def freeze(checkpoint_dir: Path) -> None:
    original.require_clean_tree()
    if FREEZE.exists() or RESULT.exists() or JOURNAL.exists():
        raise RuntimeError("Freeze/held-out file already exists")
    settings, selection, training = require_prepared(checkpoint_dir)
    config = original.config()
    manifest = {"protocol": "laya-domain-adaptation-freeze-2", "frozen_at": original.now(),
                "code_commit": original.git("rev-parse", "HEAD"), "source_hash": source_hash(),
                "training_config_sha256": original.sha256(TRAINING_CONFIG),
                "question_config_sha256": original.sha256(original.CONFIG_PATH),
                "train_sha256": settings["train_sha256"], "validation_sha256": settings["validation_sha256"],
                "heldout_sha256": original.BASELINE_DATASET_SHA256, "heldout_count": 70,
                "artifact_sha256": {name: original.sha256(path) for name, path in expected_files().items()},
                "selected_epoch": selection["selected_epoch"],
                "selected_weight_sha256": selection["selected_weight_sha256"],
                "selected_weight_bytes": (checkpoint_dir / "model.safetensors").stat().st_size,
                "selected_inference_config_sha256": original.sha256(checkpoint_dir / "rl_agent_config.json"),
                "base_revision": settings["base_revision"], "training_summary": {
                    "epochs": len(training["epoch_results"]),
                    "duration_seconds": training["total_duration_seconds"],
                    "peak_vram_bytes": max(row["cuda_peak_allocated_bytes"] for row in training["epoch_results"])},
                "inference": {"device": "cpu", "torch_threads": 4, "max_len": config["max_len"],
                              "head_max_len": config["head_max_len"], "compile": False, "fast": False,
                              "thresholds": config["selective_thresholds"]},
                "planned_runs": 1, "planned_tickets": 70}
    original.write_new_json(FREEZE, manifest)
    print(f"Freeze 2 manifest: {FREEZE.name}. Commit before held-out.")


def append_journal(event: dict) -> None:
    with JOURNAL.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, allow_nan=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def heldout(checkpoint_dir: Path) -> None:
    original.require_clean_tree()
    if RESULT.exists() or JOURNAL.exists():
        raise RuntimeError("Held-out attempt already exists; no automatic retry")
    manifest = json.loads(FREEZE.read_text())
    _, selection, _ = require_prepared(checkpoint_dir)
    if (manifest["source_hash"] != source_hash() or
            manifest["training_config_sha256"] != original.sha256(TRAINING_CONFIG) or
            manifest["selected_weight_sha256"] != selection["selected_weight_sha256"] or
            manifest["selected_inference_config_sha256"] != original.sha256(checkpoint_dir / "rl_agent_config.json") or
            manifest["heldout_sha256"] != original.sha256(original.HELDOUT_PATH) or
            manifest["artifact_sha256"] != {name: original.sha256(path) for name, path in expected_files().items()}):
        raise RuntimeError("Freeze 2 mismatch")
    subprocess.check_call(["git", "merge-base", "--is-ancestor", manifest["code_commit"], "HEAD"], cwd=ROOT)
    configuration = original.config()
    examples = original.read_dataset(original.HELDOUT_PATH, configuration)
    if len(examples) != 70:
        raise RuntimeError("Expected exactly 70 held-out tickets")
    original.write_new_json(RESULT, {"status": "reserved", "started_at": original.now()})
    with JOURNAL.open("x", encoding="utf-8"):
        pass
    append_journal({"event": "run_started", "at": original.now(), "commit": original.git("rev-parse", "HEAD")})
    start = time.perf_counter()
    torch.set_num_threads(manifest["inference"]["torch_threads"])
    hardware = original.machine_metadata()
    before = original.rss_bytes()
    load_start = time.perf_counter()
    agent = laya.load(str(checkpoint_dir), device="cpu", compile=False, fast=False)
    lifecycle = {"load_ms": (time.perf_counter() - load_start) * 1000,
                 "rss_before_bytes": before, "rss_after_bytes": original.rss_bytes(),
                 "device_actual": str(agent.device), "dtype_actual": str(agent.dtype_for(3)),
                 "checkpoint": {"weight_sha256": selection["selected_weight_sha256"],
                                "weight_bytes": (checkpoint_dir / "model.safetensors").stat().st_size}}
    rows = []
    for example in examples:
        append_journal({"event": "attempt_started", "id": example["id"], "at": original.now()})
        row = original.infer_one(agent, example, configuration)
        rows.append(row)
        append_journal({"event": "attempt_finished", "row": row, "at": original.now()})
        original.write_json(RESULT, {"status": "running", "freeze_hash": original.sha256(FREEZE),
                                     "rows": rows, "analysis": original.analyze(rows, configuration)})
        print(f"adapted held-out {len(rows)}/70: {row.get('failure', {}).get('code', 'valid')}", flush=True)
    result = {"status": "complete", "completed_at": original.now(),
              "freeze_commit": original.git("rev-parse", "HEAD"), "freeze_hash": original.sha256(FREEZE),
              "dataset_hash": original.sha256(original.HELDOUT_PATH), "hardware": hardware,
              "lifecycle": lifecycle, "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              "wall_seconds_including_load": time.perf_counter() - start,
              "rows": rows, "analysis": original.analyze(rows, configuration)}
    original.write_json(RESULT, result)
    append_journal({"event": "run_completed", "at": original.now(), "attempts": len(rows)})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("freeze", "heldout"))
    parser.add_argument("--checkpoint-dir", type=Path, default=CHECKPOINT_DIR)
    args = parser.parse_args()
    if args.mode == "freeze":
        freeze(args.checkpoint_dir)
    else:
        heldout(args.checkpoint_dir)


if __name__ == "__main__":
    main()
