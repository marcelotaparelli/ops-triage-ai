"""GPU-only full-parameter Laya domain adaptation, derived from official v0.3.23 examples.

Only the new TRAIN split is opened. Candidate checkpoints are selected later
using VALIDATION; the frozen held-out is never opened by this program.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import resource
import subprocess
import time
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from laya.agent import _fix_tokenizer_config
from laya.common import QTYPES, build_model, build_sequence, proper_reward, render_options
from safetensors.torch import load_file, save_file
from transformers import AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "scripts/laya-adapt-training-config.json"
QUESTIONS = ROOT / "scripts/laya-config.json"
TRAIN = ROOT / "datasets/laya-adapt-train.jsonl"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_item(tokenizer, cfg: dict, ticket: dict, field: str, question: dict) -> dict:
    options = list(question["criteria"])
    target_label = ticket["expected"][field]
    if target_label not in options:
        raise ValueError("Label outside question taxonomy")
    internal = {"t": "choice", "ins": question["instructions"], "crit": question["criteria"]}
    state = {"title": ticket["input"]["title"], "description": ticket["input"]["description"]}
    sequence, markers, head_stats, truncation = build_sequence(
        tokenizer, state, internal, cfg["max_len"], cfg["head_max_len"],
        return_stats=True, return_truncation_stats=True)
    if (len(markers) != len(render_options(internal)) or
            head_stats["options_distinct"] != head_stats["options"]):
        raise ValueError("Collapsed options during training tokenization")
    if truncation["state_tokens_dropped"]:
        raise ValueError("Training ticket state truncated")
    target = [float(option == target_label) for option in options]
    return {"ids": sequence, "markers": markers, "target": target, "qtype": QTYPES["choice"]}


def collate(items: list[dict], pad_id: int):
    n = len(items)
    length = max(len(item["ids"]) for item in items)
    options = max(len(item["markers"]) for item in items)
    ids = torch.full((n, length), pad_id, dtype=torch.long)
    attention = torch.zeros((n, length), dtype=torch.long)
    positions = torch.zeros((n, options), dtype=torch.long)
    mask = torch.zeros((n, options), dtype=torch.bool)
    target = torch.zeros((n, options), dtype=torch.float32)
    qtype = torch.full((n,), QTYPES["choice"], dtype=torch.long)
    for index, item in enumerate(items):
        seq_len, n_options = len(item["ids"]), len(item["markers"])
        ids[index, :seq_len] = torch.tensor(item["ids"])
        attention[index, :seq_len] = 1
        positions[index, :n_options] = torch.tensor(item["markers"])
        mask[index, :n_options] = True
        target[index, :n_options] = torch.tensor(item["target"])
    return ids, attention, positions, mask, target, qtype


def hardware() -> dict:
    import laya
    import transformers
    properties = torch.cuda.get_device_properties(0)
    return {"os": platform.platform(), "architecture": platform.machine(),
            "cpu": next((line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines()
                         if line.startswith("model name")), None),
            "logical_cpus": os.cpu_count(),
            "ram_bytes": next((int(line.split()[1]) * 1024 for line in Path("/proc/meminfo").read_text().splitlines()
                               if line.startswith("MemTotal:")), None),
            "gpu": properties.name, "vram_bytes": properties.total_memory,
            "driver": nvidia_smi("driver_version"),
            "cuda_runtime": torch.version.cuda, "torch": torch.__version__,
            "laya": laya.__version__, "transformers": transformers.__version__,
            "python": platform.python_version(), "device": "cuda:0", "dtype": "fp16 autocast, fp32 master"}


def nvidia_smi(fields: str) -> str | None:
    try:
        output = subprocess.check_output(
            ["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits", "-i", "0"],
            text=True, stderr=subprocess.DEVNULL, timeout=5)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    return output.strip() or None


def save_checkpoint(model, tokenizer, model_cfg: dict, output: Path, epoch: int) -> dict:
    destination = output / f"epoch-{epoch}"
    destination.mkdir(parents=True, exist_ok=False)
    weights = {name: tensor.detach().half().cpu().contiguous() for name, tensor in model.state_dict().items()}
    file_path = destination / "model.safetensors"
    save_file(weights, str(file_path))
    model.encoder.config.save_pretrained(destination / "encoder")
    tokenizer.save_pretrained(destination / "tokenizer")
    inference_cfg = dict(model_cfg)
    inference_cfg.update({"fine_tuned": True, "model_name": "laya-ops-triage-domain-adapted",
                          "temperature": [1.0, 1.0, 1.0]})
    inference_cfg.pop("temperature_by_options", None)
    (destination / "rl_agent_config.json").write_text(json.dumps(inference_cfg, indent=2) + "\n")
    return {"epoch": epoch, "weight_sha256": sha256(file_path), "weight_bytes": file_path.stat().st_size,
            "inference_config_sha256": sha256(destination / "rl_agent_config.json")}


def train(output: Path) -> None:
    settings = json.loads(CONFIG.read_text())
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU required; this protocol deliberately refuses CPU training")
    if torch.cuda.get_device_properties(0).total_memory < 14 * 1024 ** 3:
        raise RuntimeError("At least 14 GiB VRAM required for this full-parameter protocol")
    if output.exists():
        raise RuntimeError("Output directory exists; no implicit retry or checkpoint overwrite")
    if sha256(TRAIN) != settings["train_sha256"] or sha256(QUESTIONS) != settings["question_config_sha256"]:
        raise RuntimeError("TRAIN or question configuration hash mismatch")
    torch.manual_seed(settings["seed"])
    torch.cuda.manual_seed_all(settings["seed"])
    random.seed(settings["seed"])
    torch.set_float32_matmul_precision("high")
    base_dir = Path(snapshot_download(settings["base_model"], revision=settings["base_revision"]))
    if sha256(base_dir / "model.safetensors") != settings["base_weight_sha256"]:
        raise RuntimeError("Base model weight hash mismatch")
    _fix_tokenizer_config(str(base_dir))
    base_cfg = json.loads((base_dir / "rl_agent_config.json").read_text())
    base_cfg.update({"max_len": settings["max_len"], "head_max_len": settings["head_max_len"],
                     "max_tokens_per_batch": settings["max_len"] * settings["micro_batch_decisions"],
                     "gradient_checkpointing": True})
    tokenizer = AutoTokenizer.from_pretrained(base_dir / "tokenizer")
    questions = json.loads(QUESTIONS.read_text())["questions"]
    tickets = [json.loads(line) for line in TRAIN.read_text().splitlines() if line]
    if len(tickets) != 1120 or len({ticket["id"] for ticket in tickets}) != 1120:
        raise RuntimeError("TRAIN count or IDs invalid")
    items = [prepare_item(tokenizer, base_cfg, ticket, field, questions[field])
             for ticket in tickets for field in ("category", "priority", "risk")]
    model = build_model(base_cfg, encoder_dir=base_dir / "encoder")
    model.load_state_dict(load_file(str(base_dir / "model.safetensors")), strict=True)
    model.float()
    model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.head_checkpointing = True
    model.cuda().train()
    encoder = [parameter for name, parameter in model.named_parameters() if name.startswith("encoder.")]
    head = [parameter for name, parameter in model.named_parameters() if not name.startswith("encoder.")]
    optimizer = torch.optim.AdamW([
        {"params": encoder, "lr": settings["encoder_learning_rate"]},
        {"params": head, "lr": settings["head_learning_rate"]}], weight_decay=settings["weight_decay"])
    microbatch = settings["micro_batch_decisions"]
    accumulation = settings["gradient_accumulation"]
    total_updates = math.ceil(len(items) / microbatch / accumulation) * settings["epochs"]
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=total_updates, eta_min=settings["eta_min"])
    scaler = torch.amp.GradScaler("cuda")
    output.mkdir(parents=True)
    run_start = time.perf_counter()
    environment = hardware()
    measurements = {"protocol": settings["protocol"], "settings": settings, "hardware": environment,
                    "train_dataset_sha256": sha256(TRAIN), "base_weight_sha256": sha256(base_dir / "model.safetensors"),
                    "decisions": len(items), "epoch_results": [], "status": "running"}
    (output / "training.json").write_text(json.dumps(measurements, indent=2) + "\n")
    for epoch in range(settings["epochs"]):
        epoch_start = time.perf_counter()
        random.Random(settings["seed"] + epoch).shuffle(items)
        optimizer.zero_grad(set_to_none=True)
        total_loss, n_batches, update_count = 0.0, 0, 0
        utilization_samples = []
        sigma = settings["sigma_start"] + (settings["sigma_end"] - settings["sigma_start"]) * epoch / max(1, settings["epochs"] - 1)
        for start in range(0, len(items), microbatch):
            if time.perf_counter() - run_start > settings["max_training_seconds"]:
                raise TimeoutError("Training wall-time cap reached; no held-out inference is allowed")
            batch = collate(items[start:start + microbatch], tokenizer.pad_token_id)
            ids, attention, positions, mask, target, qtype = (tensor.cuda(non_blocking=True) for tensor in batch)
            with torch.autocast("cuda", dtype=torch.float16):
                logits, activation = model(ids, attention, positions, mask, qtype)
            logits = logits.float()
            option_count = mask.sum(-1, keepdim=True).float()
            noise = torch.randn((settings["reward_samples"],) + logits.shape, device="cuda") * sigma * mask
            noise = (noise - noise.sum(-1, keepdim=True) / option_count) * mask
            noisy_logits = logits.detach().unsqueeze(0) + noise
            probabilities = torch.softmax(noisy_logits.masked_fill(~mask, -1e4), -1)
            with torch.no_grad():
                reward = proper_reward(probabilities, target.unsqueeze(0), qtype, mask,
                                       w_sph=settings["reward_weight_spherical"],
                                       w_rps=settings["reward_weight_ranked_probability"])
                advantage = reward - reward.mean(0, keepdim=True)
                advantage = advantage / (advantage.std() + 1e-6)
            logp = -(((noisy_logits - logits.unsqueeze(0)) ** 2) * mask).sum(-1) / (2 * sigma ** 2)
            loss_rl = -(advantage * logp).mean()
            loss_ce = -(target * torch.log_softmax(logits.masked_fill(~mask, -1e4), -1)).sum(-1).mean()
            loss = (loss_rl + settings["cross_entropy_weight"] * loss_ce + 0.0 * activation.sum()) / accumulation
            scaler.scale(loss).backward()
            n_batches += 1
            total_loss += float(loss.detach()) * accumulation
            if n_batches % accumulation == 0 or start + microbatch >= len(items):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), settings["gradient_clip_norm"])
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)
                update_count += 1
            if n_batches % 100 == 0:
                observation = nvidia_smi("utilization.gpu,memory.used")
                if observation:
                    try:
                        utilization, memory_mib = (int(value.strip()) for value in observation.split(","))
                        utilization_samples.append({"batch": n_batches, "gpu_utilization_percent": utilization,
                                                    "reported_vram_used_mib": memory_mib})
                    except ValueError:
                        pass
                print(f"epoch {epoch+1}/{settings['epochs']} batch {n_batches} loss {float(loss.detach())*accumulation:.4f}", flush=True)
        checkpoint = save_checkpoint(model, tokenizer, base_cfg, output, epoch + 1)
        result = {"epoch": epoch + 1, "mean_training_loss": total_loss / n_batches,
                  "optimizer_updates": update_count, "duration_seconds": time.perf_counter() - epoch_start,
                  "cuda_peak_allocated_bytes": torch.cuda.max_memory_allocated(),
                  "cuda_peak_reserved_bytes": torch.cuda.max_memory_reserved(),
                  "nvidia_smi_samples": utilization_samples,
                  "checkpoint": checkpoint}
        measurements["epoch_results"].append(result)
        (output / "training.json").write_text(json.dumps(measurements, indent=2) + "\n")
        print(json.dumps(result), flush=True)
    measurements["status"] = "complete"
    measurements["total_duration_seconds"] = time.perf_counter() - run_start
    measurements["peak_rss_bytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    (output / "training.json").write_text(json.dumps(measurements, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True, help="new directory with epoch checkpoints and training.json")
    args = parser.parse_args()
    train(args.output_dir)


if __name__ == "__main__":
    main()
