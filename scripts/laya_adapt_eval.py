"""Experiment B validation. No held-out mode exists before Freeze 2."""

from __future__ import annotations

import argparse
import json
import resource
import time
from pathlib import Path

import laya_eval as original

ROOT = Path(__file__).resolve().parents[1]
VALIDATION = ROOT / "datasets/laya-adapt-validation.jsonl"
TRAIN = ROOT / "datasets/laya-adapt-train.jsonl"
DATASET_METADATA = ROOT / "artifacts/laya-adapt-dataset.json"
OUTPUT = ROOT / "artifacts/laya-adapt-base-validation.json"


def load_candidate(checkpoint_dir: Path):
    import laya
    before = original.rss_bytes()
    started = time.perf_counter()
    agent = laya.load(str(checkpoint_dir), device="cuda", compile=False, fast=False)
    weight = checkpoint_dir / "model.safetensors"
    lifecycle = {"load_ms": round((time.perf_counter() - started) * 1000, 4),
                 "rss_before_bytes": before, "rss_after_bytes": original.rss_bytes(),
                 "device_actual": str(agent.device), "dtype_actual": str(agent.dtype_for(3)),
                 "checkpoint": {"weight_bytes": weight.stat().st_size, "weight_sha256": original.sha256(weight)}}
    return agent, lifecycle


def run(mode: str, checkpoint_dir: Path | None, output: Path, epoch: int | None) -> None:
    configuration = original.config()
    metadata = json.loads(DATASET_METADATA.read_text(encoding="utf-8"))
    split = "train" if mode == "selected-train" else "validation"
    dataset = TRAIN if split == "train" else VALIDATION
    if original.sha256(dataset) != metadata["splits"][split]["sha256"]:
        raise RuntimeError(f"{split} dataset hash mismatch")
    examples = original.read_dataset(dataset, configuration)
    if len(examples) != metadata["splits"][split]["count"]:
        raise RuntimeError(f"{split} ticket count mismatch")
    if output.exists():
        raise RuntimeError("Validation artifact already exists; no implicit overwrite")
    if mode != "base-validation" and (checkpoint_dir is None or epoch is None):
        raise ValueError("Candidate and selected-train runs require a checkpoint and epoch")
    started = time.perf_counter()
    hardware = original.machine_metadata()
    agent, lifecycle = (original.load_model(configuration) if mode == "base-validation"
                        else load_candidate(checkpoint_dir))
    hardware["device"] = lifecycle["device_actual"]
    hardware["dtype"] = lifecycle["dtype_actual"]
    rows = []
    for index, example in enumerate(examples, 1):
        row = original.infer_one(agent, example, configuration)
        rows.append(row)
        if index % 25 == 0:
            print(f"{mode} {index}/{len(examples)}", flush=True)
    artifact = {
        "experiment": "B", "mode": mode, "split": split, "epoch": epoch, "completed_at": original.now(),
        "code_commit": original.git("rev-parse", "HEAD"),
        "base_checkpoint": configuration["model"], "base_revision": configuration["revision"],
        "question_config_sha256": original.sha256(original.CONFIG_PATH),
        "dataset_sha256": original.sha256(dataset),
        "hardware": hardware, "lifecycle": lifecycle,
        "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        "wall_seconds_including_load": time.perf_counter() - started,
        "rows": rows, "analysis": original.analyze(rows, configuration),
    }
    original.write_new_json(output, artifact)
    print(json.dumps({"valid": artifact["analysis"]["valid"], "metrics": artifact["analysis"]["metrics"],
                      "latency_ms": artifact["analysis"]["latency_ms"], "output": output.name},
                     indent=2), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("base-validation", "candidate-validation", "selected-train"),
                        default="base-validation")
    parser.add_argument("--checkpoint-dir", type=Path)
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--epoch", type=int)
    args = parser.parse_args()
    output = args.artifact or OUTPUT
    if args.mode != "base-validation" and not args.artifact:
        parser.error("Candidate and selected-train runs require --artifact")
    run(args.mode, args.checkpoint_dir, output, args.epoch)


if __name__ == "__main__":
    main()
