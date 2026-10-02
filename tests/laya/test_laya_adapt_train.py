"""Target ordering and rejection paths for the isolated training adapter."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import torch
from laya.common import proper_reward

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

    def test_one_hot_target_is_valid_for_official_reward(self):
        items = [{"ids": [10, 11, 12], "markers": [0, 1, 2, 3],
                  "target": [1.0, 0.0, 0.0, 0.0], "qtype": training.QTYPES["choice"]},
                 {"ids": [10, 11], "markers": [0, 1, 2],
                  "target": [0.0, 1.0, 0.0], "qtype": training.QTYPES["choice"]}]
        ids, attention, positions, mask, target, qtype = training.collate(items, pad_id=0)
        self.assertEqual(tuple(ids.shape), (2, 3))
        self.assertEqual(int(attention[1].sum()), 2)
        self.assertEqual(tuple(positions.shape), (2, 4))
        probabilities = torch.softmax(torch.randn(4, 2, 4).masked_fill(~mask, -1e4), -1)
        rewards = proper_reward(probabilities, target.unsqueeze(0), qtype, mask, w_sph=.75, w_rps=1.0)
        self.assertEqual(tuple(rewards.shape), (4, 2))
        self.assertTrue(bool(torch.isfinite(rewards).all()))


class ScalerSchedulerCoordinationTests(unittest.TestCase):
    def setUp(self):
        self.parameter = torch.nn.Parameter(torch.tensor(1.0))
        self.optimizer = torch.optim.SGD([self.parameter], lr=0.1)
        self.scheduler = torch.optim.lr_scheduler.LambdaLR(self.optimizer, lambda _: 1.0)
        self.scaler = torch.amp.GradScaler("cpu")

    def test_applied_optimizer_update_advances_scheduler(self):
        scheduler_step_before = self.scheduler.last_epoch
        parameter_before = self.parameter.detach().clone()
        scale_before = self.scaler.get_scale()
        self.scaler.scale(self.parameter.square()).backward()
        self.scaler.unscale_(self.optimizer)

        applied = training.scaler_step_and_schedule(self.scaler, self.optimizer, self.scheduler)

        self.assertTrue(applied)
        self.assertEqual(self.scheduler.last_epoch, scheduler_step_before + 1)
        self.assertNotEqual(self.parameter.item(), parameter_before.item())
        self.assertEqual(self.scaler.get_scale(), scale_before)

    def test_grad_scaler_overflow_skips_optimizer_and_scheduler(self):
        scheduler_step_before = self.scheduler.last_epoch
        parameter_before = self.parameter.detach().clone()
        scale_before = self.scaler.get_scale()
        infinite_loss = self.parameter * torch.tensor(float("inf"))
        self.scaler.scale(infinite_loss).backward()
        self.scaler.unscale_(self.optimizer)

        applied = training.scaler_step_and_schedule(self.scaler, self.optimizer, self.scheduler)

        self.assertFalse(applied)
        self.assertEqual(self.scheduler.last_epoch, scheduler_step_before)
        self.assertEqual(self.parameter.item(), parameter_before.item())
        self.assertLess(self.scaler.get_scale(), scale_before)


if __name__ == "__main__":
    unittest.main()
