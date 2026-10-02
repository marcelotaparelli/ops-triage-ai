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
CHECKPOINT_METADATA = ROOT / "artifacts/laya-adapt-checkpoint-metadata.json"
RUN1_DIR = ROOT / "artifacts/laya-adapt-run1-scheduler-anomaly"
MEASURED_GPU_RATE_USD_PER_HOUR = 0.27
MEASURED_DEPLOYMENT_RATE_USD_PER_HOUR = 0.28
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
              "selection": SELECTION, "selected_train": SELECTED_TRAIN,
              "selected_checkpoint_metadata": CHECKPOINT_METADATA}
    settings = json.loads(TRAINING_CONFIG.read_text())
    for epoch in range(1, settings["epochs"] + 1):
        result[f"validation_epoch_{epoch}"] = ROOT / f"artifacts/laya-adapt-validation-epoch-{epoch}.json"
    return result


def require_prepared(checkpoint_dir: Path) -> tuple[dict, dict, dict]:
    settings = json.loads(TRAINING_CONFIG.read_text())
    selection = json.loads(SELECTION.read_text())
    training = json.loads(TRAINING.read_text())
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
    if (training.get("optimizer_update_attempts") != 420 or
            training.get("optimizer_updates_applied") != 413 or
            training.get("grad_scaler_skipped_updates") != 7 or
            training.get("scheduler_steps") != 413 or
            training.get("scheduler_steps") != training.get("optimizer_updates_applied")):
        raise RuntimeError("Corrected optimizer/scheduler accounting does not match the approved run")
    if selection["selected_epoch"] != 4:
        raise RuntimeError("Freeze 2 requires the approved epoch-4 selection")
    config = original.config()
    dataset_metadata = json.loads((ROOT / "artifacts/laya-adapt-dataset.json").read_text())
    checkpoint_metadata = json.loads(CHECKPOINT_METADATA.read_text())
    run1_files = sorted(path for path in RUN1_DIR.iterdir() if path.is_file())
    run1_training = json.loads((RUN1_DIR / "laya-adapt-training.json").read_text())
    run1_selection = json.loads((RUN1_DIR / "laya-adapt-selection.json").read_text())
    run1_eval_seconds = (sum(json.loads((RUN1_DIR / f"laya-adapt-validation-epoch-{epoch}.json").read_text())
                             ["wall_seconds_including_load"] for epoch in range(1, settings["epochs"] + 1)) +
                        json.loads((RUN1_DIR / "laya-adapt-selected-train.json").read_text())
                        ["wall_seconds_including_load"])
    # The first run was retained with its original scheduler anomaly. Its timing
    # is informational and never participates in selecting the approved run.
    run1_task_seconds = run1_training["total_duration_seconds"] + run1_eval_seconds
    corrected_candidate_seconds = sum(json.loads((ROOT / f"artifacts/laya-adapt-validation-epoch-{epoch}.json").read_text())
                                      ["wall_seconds_including_load"] for epoch in range(1, settings["epochs"] + 1))
    corrected_candidate_seconds += json.loads(SELECTED_TRAIN.read_text())["wall_seconds_including_load"]
    base_validation_seconds = json.loads(BASE_VALIDATION.read_text())["wall_seconds_including_load"]
    measured_task_seconds = (run1_task_seconds + training["total_duration_seconds"] +
                             corrected_candidate_seconds + base_validation_seconds)
    inference_config = json.loads((checkpoint_dir / "rl_agent_config.json").read_text())
    manifest = {"protocol": "laya-domain-adaptation-freeze-2", "frozen_at": original.now(),
                "code_commit": original.git("rev-parse", "HEAD"), "source_hash": source_hash(),
                "training_config_sha256": original.sha256(TRAINING_CONFIG),
                "question_config_sha256": original.sha256(original.CONFIG_PATH),
                "train_sha256": settings["train_sha256"], "validation_sha256": settings["validation_sha256"],
                "heldout_sha256": original.BASELINE_DATASET_SHA256, "heldout_count": 70,
                "artifact_sha256": {name: original.sha256(path) for name, path in expected_files().items()},
                "base_checkpoint": {"model": settings["base_model"], "revision": settings["base_revision"],
                                    "weight_sha256": settings["base_weight_sha256"]},
                "training_settings": settings,
                "training_hardware": training["hardware"],
                "optimizer_accounting": {key: training[key] for key in
                                          ("optimizer_update_attempts", "optimizer_updates_applied",
                                           "grad_scaler_skipped_updates", "scheduler_steps")},
                "optimizer_accounting_by_epoch": [{key: row[key] for key in
                                                    ("epoch", "optimizer_update_attempts", "optimizer_updates_applied",
                                                     "grad_scaler_skipped_updates", "scheduler_steps")}
                                                   for row in training["epoch_results"]],
                "amp_grad_scaler_behavior": {
                    "precision": settings["precision"],
                    "rule": "scheduler advances only when an optimizer post-step hook confirms optimizer.step() ran",
                    "overflow_action": "GradScaler-skipped updates do not advance the scheduler",
                    "unit_tests": ["applied optimizer update advances scheduler",
                                   "GradScaler overflow skip leaves scheduler unchanged"]},
                "selected_epoch": selection["selected_epoch"],
                "selected_weight_sha256": selection["selected_weight_sha256"],
                "selected_weight_bytes": (checkpoint_dir / "model.safetensors").stat().st_size,
                "selected_inference_config_sha256": original.sha256(checkpoint_dir / "rl_agent_config.json"),
                "selected_inference_config": inference_config,
                "selected_checkpoint_metadata": checkpoint_metadata,
                "checkpoint_selection_rule": settings["checkpoint_selection"],
                "taxonomy_mapping": {
                    "source": "scripts/laya_adapt_dataset.py authored operational taxonomy/scenarios",
                    "source_sha256": original.sha256(ROOT / "scripts/laya_adapt_dataset.py"),
                    "labels": {field: sorted(dataset_metadata["splits"]["train"][field])
                               for field in ("category", "priority", "risk")},
                    "project_mapping": "identity mapping to existing project category/priority/risk enum values",
                    "dataset_metadata_sha256": original.sha256(ROOT / "artifacts/laya-adapt-dataset.json")},
                "calibration_and_thresholds": {
                    "training_temperature_method": settings["temperature_method"],
                    "selected_inference_temperature": inference_config.get("temperature"),
                    "selective_thresholds": config["selective_thresholds"],
                    "thresholds_tuned_on_heldout": False},
                "first_run_scheduler_anomaly": {
                    "status": "retained for audit; rejected for methodological validity, not accuracy",
                    "pre_correction_validation_code_commit": "d96a31c015c0a8b783883134242ac5b6ed6cc33f",
                    "scheduler_warning": "scheduler.step() was unconditional after scaler.step(); GradScaler skipped an optimizer update",
                    "internal_found_inf_record_retained": False,
                    "selected_epoch_in_first_run": run1_selection["selected_epoch"],
                    "selected_checkpoint_path": ".cache/laya-adapt-run1-selected/model.safetensors",
                    "selected_checkpoint_sha256": original.sha256(ROOT / ".cache/laya-adapt-run1-selected/model.safetensors"),
                    "training_artifact_sha256": original.sha256(RUN1_DIR / "laya-adapt-training.json"),
                    "artifact_sha256": {path.name: original.sha256(path) for path in run1_files},
                    "measured_training_and_eval_seconds": run1_task_seconds},
                "cost": {
                    "pod_gpu_rate_usd_per_hour_observed": MEASURED_GPU_RATE_USD_PER_HOUR,
                    "pod_deployment_rate_with_container_disk_usd_per_hour_observed": MEASURED_DEPLOYMENT_RATE_USD_PER_HOUR,
                    "base_validation_seconds": base_validation_seconds,
                    "first_anomalous_run_training_and_eval_seconds": run1_task_seconds,
                    "corrected_run_training_and_eval_seconds": training["total_duration_seconds"] + corrected_candidate_seconds,
                    "total_measured_training_and_evaluation_seconds": measured_task_seconds,
                    "estimated_cost_at_gpu_rate_usd": measured_task_seconds / 3600 * MEASURED_GPU_RATE_USD_PER_HOUR,
                    "estimated_cost_at_deployment_rate_usd": measured_task_seconds / 3600 * MEASURED_DEPLOYMENT_RATE_USD_PER_HOUR,
                    "pod_total_billed_seconds": None,
                    "invoice_available": False,
                    "estimate_scope": "measured experiment task durations only; excludes setup, provider startup and idle time"},
                "base_revision": settings["base_revision"], "training_summary": {
                    "epochs": len(training["epoch_results"]),
                    "duration_seconds": training["total_duration_seconds"],
                    "peak_vram_bytes": max(row["cuda_peak_allocated_bytes"] for row in training["epoch_results"]),
                    "optimizer_update_attempts": training["optimizer_update_attempts"],
                    "optimizer_updates_applied": training["optimizer_updates_applied"],
                    "grad_scaler_skipped_updates": training["grad_scaler_skipped_updates"],
                    "scheduler_steps": training["scheduler_steps"]},
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
