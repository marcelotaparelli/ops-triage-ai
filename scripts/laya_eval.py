"""Isolated Laya evaluation. No application/runtime imports or held-out tuning."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import resource
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "scripts/laya-config.json"
DEV_PATH = ROOT / "datasets/triage-dev.jsonl"
HELDOUT_PATH = ROOT / "datasets/triage-eval.jsonl"
DEV_ARTIFACT = ROOT / "artifacts/laya-dev-smoke.json"
FREEZE_PATH = ROOT / "artifacts/laya-freeze.json"
HELDOUT_ARTIFACT = ROOT / "artifacts/laya-held-out.json"
JOURNAL_PATH = ROOT / "artifacts/laya-held-out-attempts.jsonl"
BASELINE_DATASET_SHA256 = "e3864aaefba8327dff78a0e7680df55650c995664e29daea31aaab85abe63ab0"
FIELDS = ("category", "priority", "risk")
SOURCE_PATHS = (Path("scripts/laya_eval.py"), Path("scripts/laya-config.json"),
                Path("scripts/laya-requirements.txt"), Path("tests/laya/test_laya_eval.py"))


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_hash() -> str:
    digest = hashlib.sha256()
    for relative in SOURCE_PATHS:
        digest.update(str(relative).encode())
        digest.update(b"\n")
        digest.update((ROOT / relative).read_bytes())
        digest.update(b"\n")
    return digest.hexdigest()


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def require_clean_tree() -> None:
    if git("status", "--porcelain"):
        raise RuntimeError("A clean, committed tree is required")


def write_new_json(path: Path, value: dict[str, Any]) -> None:
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False, allow_nan=False)
        handle.write("\n")


def write_json(path: Path, value: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False, allow_nan=False)
        handle.write("\n")


def append_journal(value: dict[str, Any]) -> None:
    with JOURNAL_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, allow_nan=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def config() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def taxonomy(configuration: dict[str, Any]) -> dict[str, tuple[str, ...]]:
    return {field: tuple(configuration["questions"][field]["criteria"]) for field in FIELDS}


def read_dataset(path: Path, configuration: dict[str, Any]) -> list[dict[str, Any]]:
    labels = taxonomy(configuration)
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Empty dataset or duplicate IDs")
    for row in rows:
        if not isinstance(row["input"].get("title"), str) or not isinstance(row["input"].get("description"), str):
            raise ValueError("Invalid ticket input")
        for field in FIELDS:
            if row["expected"][field] not in labels[field]:
                raise ValueError("Ground truth outside frozen taxonomy")
    return rows


class InvalidOutput(ValueError):
    pass


def parse_result(raw: Any, configuration: dict[str, Any]) -> dict[str, Any]:
    """Validate only published choice fields; retain both confidence semantics."""
    if not isinstance(raw, dict) or not isinstance(raw.get("answers"), dict):
        raise InvalidOutput("missing answers")
    labels = taxonomy(configuration)
    if set(raw["answers"]) != set(FIELDS):
        raise InvalidOutput("missing or extra answer")
    usage = raw.get("usage", {})
    if not isinstance(usage, dict):
        raise InvalidOutput("invalid usage")
    if usage.get("truncated") or usage.get("state_tokens_dropped", 0) or usage.get("options"):
        raise InvalidOutput("context or option truncation")
    answers = {}
    for field in FIELDS:
        answer = raw["answers"][field]
        if not isinstance(answer, dict) or answer.get("type") != "choice":
            raise InvalidOutput("invalid answer type")
        probabilities = answer.get("probabilities")
        if not isinstance(probabilities, dict) or set(probabilities) != set(labels[field]):
            raise InvalidOutput("invalid probability labels")
        if any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1
               for value in probabilities.values()):
            raise InvalidOutput("invalid probability")
        # Laya publishes four-decimal probabilities, so allow one rounding unit per option.
        if abs(sum(probabilities.values()) - 1) > len(probabilities) * 0.0001:
            raise InvalidOutput("probabilities do not sum to one")
        choice = answer.get("choice")
        if choice not in labels[field] or probabilities[choice] < max(probabilities.values()) - 0.0001:
            raise InvalidOutput("invalid top choice")
        confidence = answer.get("confidence")
        answer_confidence = answer.get("answer_confidence")
        if any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1
               for value in (confidence, answer_confidence)):
            raise InvalidOutput("invalid confidence")
        if abs(answer_confidence - max(probabilities.values())) > 0.0001:
            raise InvalidOutput("answer confidence differs from top probability")
        sorted_values = sorted(probabilities.values(), reverse=True)
        answers[field] = {
            "choice": choice,
            "confidence": confidence,
            "answer_confidence": answer_confidence,
            "probabilities": probabilities,
            "margin": round(sorted_values[0] - sorted_values[1], 4),
        }
    safe_usage = {key: usage[key] for key in
                  ("input_tokens", "output_tokens", "state_tokens", "state_tokens_dropped", "truncated", "truncated_questions")
                  if key in usage}
    return {"answers": answers, "usage": safe_usage}


def rss_bytes() -> int:
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) * 1024
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024


def machine_metadata() -> dict[str, Any]:
    memory = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith(("MemTotal:", "MemAvailable:")):
            key, value = line.split(":", 1)
            memory[key] = int(value.split()[0]) * 1024
    cpu_model = next((line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines()
                      if line.startswith("model name")), None)
    os_release = {}
    for line in Path("/etc/os-release").read_text().splitlines():
        if line.startswith(("ID=", "VERSION_ID=", "PRETTY_NAME=")):
            key, value = line.split("=", 1)
            os_release[key] = value.strip('"')
    import torch
    import laya
    import transformers
    return {
        "os": platform.platform(), "os_release": os_release,
        "architecture": platform.machine(), "cpu_model": cpu_model,
        "logical_cpus": os.cpu_count(), "memory_bytes": memory,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "vram_bytes": torch.cuda.get_device_properties(0).total_memory if torch.cuda.is_available() else None,
        "cuda_version": torch.version.cuda, "python": sys.version.split()[0],
        "torch": torch.__version__, "transformers": transformers.__version__, "laya": laya.__version__,
        "device": "cpu", "dtype": "float32",
    }


def load_model(configuration: dict[str, Any]):
    import laya
    import torch
    torch.set_num_threads(configuration["torch_threads"])
    before = rss_bytes()
    started = time.perf_counter()
    agent = laya.load(configuration["model"], device=configuration["device"],
                      revision=configuration["revision"], compile=configuration["compile"],
                      fast=configuration["fast"])
    cache_root = Path(os.environ.get("HF_HOME", str(Path.home() / ".cache/huggingface")))
    model_path = (cache_root / "hub" / "models--convaiinnovations--laya" / "snapshots" /
                  configuration["revision"] / "model.safetensors")
    checkpoint = ({"weight_bytes": model_path.stat().st_size, "weight_sha256": sha256(model_path)}
                  if model_path.exists() else {"weight_bytes": None, "weight_sha256": None})
    return agent, {"load_ms": round((time.perf_counter() - started) * 1000, 4),
                   "rss_before_bytes": before, "rss_after_bytes": rss_bytes(),
                   "device_actual": str(agent.device), "dtype_actual": str(agent.dtype_for(3)),
                   "checkpoint": checkpoint}


def infer_one(agent: Any, example: dict[str, Any], configuration: dict[str, Any]) -> dict[str, Any]:
    state = {"title": example["input"]["title"], "description": example["input"]["description"]}
    started = time.perf_counter()
    try:
        raw = agent.predict(state, configuration["questions"], max_len=configuration["max_len"],
                            head_max_len=configuration["head_max_len"])
        latency_ms = (time.perf_counter() - started) * 1000
        result = parse_result(raw, configuration)
        return {"id": example["id"], "expected": example["expected"], "result": result,
                "latency_ms": round(latency_ms, 4)}
    except InvalidOutput as error:
        return {"id": example["id"], "expected": example["expected"],
                "failure": {"code": "SCHEMA", "reason": str(error)},
                "latency_ms": round((time.perf_counter() - started) * 1000, 4)}
    except Exception as error:
        # Never save exception text: upstream exceptions may include local cache paths or tokens.
        return {"id": example["id"], "expected": example["expected"],
                "failure": {"code": "MODEL", "type": type(error).__name__},
                "latency_ms": round((time.perf_counter() - started) * 1000, 4)}


def nearest_rank(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * quantile) - 1)]


def analyze(rows: list[dict[str, Any]], configuration: dict[str, Any]) -> dict[str, Any]:
    if not rows:
        return {"attempts": 0}
    labels = taxonomy(configuration)
    valid = [row for row in rows if "result" in row]
    def choice(row: dict[str, Any], field: str) -> str | None:
        return row.get("result", {}).get("answers", {}).get(field, {}).get("choice")
    def correct(row: dict[str, Any], field: str) -> bool:
        return choice(row, field) == row["expected"][field]
    def proportion(n: int, d: int) -> float:
        return round(n / d, 4) if d else 0.0
    metrics = {f"{field}Accuracy": proportion(sum(correct(row, field) for row in rows), len(rows)) for field in FIELDS}
    f1 = []
    for label in labels["category"]:
        tp = sum(correct(row, "category") and row["expected"]["category"] == label for row in rows)
        fp = sum(choice(row, "category") == label and row["expected"]["category"] != label for row in rows)
        fn = sum(row["expected"]["category"] == label and not correct(row, "category") for row in rows)
        f1.append(2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0)
    metrics["categoryMacroF1"] = round(sum(f1) / len(f1), 4)
    high_priority = [row for row in rows if row["expected"]["priority"] in ("HIGH", "CRITICAL")]
    high_risk = [row for row in rows if row["expected"]["risk"] == "HIGH"]
    metrics["highCriticalPriorityRecall"] = proportion(
        sum(choice(row, "priority") in ("HIGH", "CRITICAL") for row in high_priority), len(high_priority))
    metrics["highRiskRecall"] = proportion(sum(correct(row, "risk") for row in high_risk), len(high_risk))
    metrics["exactTupleAccuracy"] = proportion(sum(all(correct(row, field) for field in FIELDS) for row in rows), len(rows))
    calibration = {}
    for field in FIELDS:
        details = []
        for row in valid:
            answer = row["result"]["answers"][field]
            probabilities = answer["probabilities"]
            details.append({"id": row["id"], "correct": correct(row, field),
                            "confidence": answer["confidence"],
                            "top_probability": answer["answer_confidence"],
                            "margin": answer["margin"],
                            "brier": sum((p - int(label == row["expected"][field])) ** 2
                                         for label, p in probabilities.items())})
        buckets = []
        for index in range(5):
            low, high = index / 5, (index + 1) / 5
            selected = [d for d in details if low <= d["top_probability"] < high or
                        (index == 4 and d["top_probability"] == 1)]
            buckets.append({"low": low, "high": high, "count": len(selected),
                            "accuracy": sum(d["correct"] for d in selected) / len(selected) if selected else None,
                            "mean_probability": sum(d["top_probability"] for d in selected) / len(selected)
                            if selected else None})
        calibration[field] = {
            "brier": sum(d["brier"] for d in details) / len(details) if details else None,
            "ece": sum(b["count"] / len(details) * abs(b["accuracy"] - b["mean_probability"])
                       for b in buckets if b["count"]) if details else None,
            "mean_answer_confidence": sum(d["top_probability"] for d in details) / len(details) if details else None,
            "mean_entropy_confidence": sum(d["confidence"] for d in details) / len(details) if details else None,
            "mean_margin": sum(d["margin"] for d in details) / len(details) if details else None,
            "buckets": buckets, "details": details,
        }
    selective = []
    for threshold in configuration["selective_thresholds"]:
        selected = [row for row in valid if all(row["result"]["answers"][field]["answer_confidence"] >= threshold
                                                 for field in FIELDS)]
        selective.append({"threshold": threshold, "count": len(selected),
                          "coverage": len(selected) / len(rows),
                          "exactTupleAccuracy": sum(all(correct(row, field) for field in FIELDS)
                                                    for row in selected) / len(selected) if selected else None})
    latencies = [row["latency_ms"] for row in rows]
    warm = latencies[1:]
    return {"attempts": len(rows), "valid": len(valid),
            "failures": dict(Counter(row["failure"]["code"] for row in rows if "failure" in row)),
            "metrics": metrics,
            "latency_ms": {"cold_first": latencies[0], "warm_mean": sum(warm) / len(warm) if warm else None,
                           "mean": sum(latencies) / len(latencies), "p50": nearest_rank(latencies, 0.5),
                           "p95": nearest_rank(latencies, 0.95), "max": max(latencies),
                           "sequential_requests_per_second": 1000 * len(rows) / sum(latencies)},
            "calibration": calibration, "selective": selective}


def run_dev(configuration: dict[str, Any]) -> None:
    if FREEZE_PATH.exists() or DEV_ARTIFACT.exists():
        raise RuntimeError("DEV smoke already recorded or protocol frozen")
    examples = read_dataset(DEV_PATH, configuration)
    selected = [next(row for row in examples if row["id"] == ident) for ident in configuration["smoke_ids"]]
    hardware = machine_metadata()
    agent, lifecycle = load_model(configuration)
    rows = [infer_one(agent, example, configuration) for example in selected]
    states = [{"title": example["input"]["title"], "description": example["input"]["description"]}
              for example in selected]
    batch_started = time.perf_counter()
    batch_raw = agent.predict_batch(states, configuration["questions"], batch_size=len(states),
                                    max_len=configuration["max_len"], head_max_len=configuration["head_max_len"])
    batch_ms = (time.perf_counter() - batch_started) * 1000
    batch_parsed = [parse_result(raw, configuration) for raw in batch_raw]
    batch_dev = {"tickets": len(batch_parsed), "batch_size": len(states), "latency_ms": round(batch_ms, 4),
                 "tickets_per_second": len(states) * 1000 / batch_ms,
                 "choice_agreement_with_sequential": sum(
                     all(batch_parsed[index]["answers"][field]["choice"] == rows[index]["result"]["answers"][field]["choice"]
                         for field in FIELDS) for index in range(len(states))),
                 "rss_after_bytes": rss_bytes()}
    artifact = {"mode": "dev", "created_at": now(), "code_commit": git("rev-parse", "HEAD"),
                "source_hash": source_hash(), "dataset_hash": sha256(DEV_PATH), "configuration": configuration,
                "hardware": hardware, "lifecycle": lifecycle, "rows": rows, "analysis": analyze(rows, configuration),
                "batch_dev": batch_dev,
                "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024}
    write_new_json(DEV_ARTIFACT, artifact)
    print(f"DEV smoke: {len(rows)} attempts, {artifact['analysis']['valid']} valid; {DEV_ARTIFACT.relative_to(ROOT)}")


def run_freeze(configuration: dict[str, Any]) -> None:
    require_clean_tree()
    if FREEZE_PATH.exists() or JOURNAL_PATH.exists() or HELDOUT_ARTIFACT.exists():
        raise RuntimeError("Freeze or held-out artifacts already exist")
    smoke = json.loads(DEV_ARTIFACT.read_text(encoding="utf-8"))
    if (smoke["source_hash"] != source_hash() or smoke["configuration"] != configuration or
            smoke["analysis"]["valid"] != len(configuration["smoke_ids"]) or smoke["analysis"]["failures"] or
            smoke["batch_dev"]["tickets"] != len(configuration["smoke_ids"]) or
            sha256(HELDOUT_PATH) != BASELINE_DATASET_SHA256):
        raise RuntimeError("DEV smoke, sources, or historical dataset hash mismatch")
    manifest = {"protocol": configuration["protocol"], "frozen_at": now(),
                "code_commit": git("rev-parse", "HEAD"), "source_hash": source_hash(),
                "config_hash": sha256(CONFIG_PATH), "dev_artifact_hash": sha256(DEV_ARTIFACT),
                "dataset_hash": sha256(HELDOUT_PATH), "dataset_count": 70, "planned_runs": 1,
                "planned_tickets": 70, "checkpoint": configuration["model"],
                "checkpoint_revision": configuration["revision"], "library": configuration["library"],
                "device": configuration["device"], "dtype": smoke["lifecycle"]["dtype_actual"],
                "thresholds": configuration["selective_thresholds"], "configuration": configuration}
    write_new_json(FREEZE_PATH, manifest)
    print(f"Freeze manifest written: {FREEZE_PATH.relative_to(ROOT)}. Commit it before held-out.")


def run_heldout(configuration: dict[str, Any]) -> None:
    require_clean_tree()
    freeze = json.loads(FREEZE_PATH.read_text(encoding="utf-8"))
    if (freeze["source_hash"] != source_hash() or freeze["config_hash"] != sha256(CONFIG_PATH) or
            freeze["dev_artifact_hash"] != sha256(DEV_ARTIFACT) or
            freeze["dataset_hash"] != sha256(HELDOUT_PATH) or
            freeze["dataset_hash"] != BASELINE_DATASET_SHA256 or freeze["configuration"] != configuration):
        raise RuntimeError("Freeze mismatch")
    subprocess.check_call(["git", "merge-base", "--is-ancestor", freeze["code_commit"], "HEAD"], cwd=ROOT)
    examples = read_dataset(HELDOUT_PATH, configuration)
    if len(examples) != 70:
        raise RuntimeError("Held-out must contain exactly 70 rows")
    # Both exclusive files are reserved before loading or predicting; no automatic retries.
    write_new_json(HELDOUT_ARTIFACT, {"status": "reserved", "started_at": now()})
    with JOURNAL_PATH.open("x", encoding="utf-8"):
        pass
    append_journal({"event": "run_started", "at": now(), "commit": git("rev-parse", "HEAD")})
    started = time.perf_counter()
    hardware = machine_metadata()
    agent, lifecycle = load_model(configuration)
    rows = []
    for example in examples:
        append_journal({"event": "attempt_started", "id": example["id"], "at": now()})
        row = infer_one(agent, example, configuration)
        rows.append(row)
        append_journal({"event": "attempt_finished", "row": row, "at": now()})
        write_json(HELDOUT_ARTIFACT, {"status": "running", "freeze_commit": git("rev-parse", "HEAD"),
                                      "freeze_hash": sha256(FREEZE_PATH), "configuration": configuration,
                                      "hardware": hardware, "lifecycle": lifecycle, "rows": rows,
                                      "analysis": analyze(rows, configuration)})
        print(f"held-out {len(rows)}/70: {row.get('failure', {}).get('code', 'valid')}", flush=True)
    artifact = {"status": "complete", "completed_at": now(), "freeze_commit": git("rev-parse", "HEAD"),
                "freeze_hash": sha256(FREEZE_PATH), "configuration": configuration,
                "dataset_hash": sha256(HELDOUT_PATH), "hardware": hardware, "lifecycle": lifecycle,
                "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
                "wall_seconds_including_load": time.perf_counter() - started,
                "rows": rows, "analysis": analyze(rows, configuration)}
    write_json(HELDOUT_ARTIFACT, artifact)
    append_journal({"event": "run_completed", "at": now(), "attempts": len(rows)})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("dev", "freeze", "heldout"))
    mode = parser.parse_args().mode
    configuration = config()
    if mode == "dev":
        run_dev(configuration)
    elif mode == "freeze":
        run_freeze(configuration)
    else:
        run_heldout(configuration)


if __name__ == "__main__":
    main()
