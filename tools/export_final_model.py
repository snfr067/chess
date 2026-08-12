"""將 GPU 訓練器的 final_model.pt 轉成瀏覽器可執行的 ONNX。"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import torch
from torch import Tensor, nn


BOARD_CHANNELS = 18
GLOBAL_DIM = 54
HISTORY_DIM = 79
ACTION_DIM = 106


@dataclass(frozen=True)
class ModelConfig:
    channels: int = 64
    residual_blocks: int = 4
    state_dim: int = 256
    action_hidden: int = 128
    history_hidden: int = 96


class ResidualBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.body = nn.Sequential(
            nn.Conv2d(channels, channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
            nn.ReLU(inplace=False),
            nn.Conv2d(channels, channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
        )
        self.activation = nn.ReLU(inplace=False)

    def forward(self, inputs: Tensor) -> Tensor:
        return self.activation(inputs + self.body(inputs))


class DarkChessNet(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        channels = config.channels
        self.board_encoder = nn.Sequential(
            nn.Conv2d(BOARD_CHANNELS, channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
            nn.ReLU(inplace=False),
            *(ResidualBlock(channels) for _ in range(config.residual_blocks)),
            nn.Flatten(),
            nn.Linear(channels * 4 * 8, config.state_dim),
            nn.ReLU(inplace=False),
        )
        self.global_encoder = nn.Sequential(
            nn.Linear(GLOBAL_DIM, 128), nn.ReLU(inplace=False),
            nn.Linear(128, 128), nn.ReLU(inplace=False),
        )
        self.history_encoder = nn.GRU(HISTORY_DIM, config.history_hidden, batch_first=True)
        self.state_fusion = nn.Sequential(
            nn.Linear(config.state_dim + 128 + config.history_hidden, config.state_dim),
            nn.ReLU(inplace=False),
            nn.LayerNorm(config.state_dim),
        )
        self.action_encoder = nn.Sequential(
            nn.Linear(ACTION_DIM, config.action_hidden), nn.ReLU(inplace=False),
            nn.Linear(config.action_hidden, config.action_hidden), nn.ReLU(inplace=False),
        )
        self.candidate_fusion = nn.Sequential(
            nn.Linear(config.state_dim + config.action_hidden, 256), nn.ReLU(inplace=False),
            nn.Linear(256, 128), nn.ReLU(inplace=False),
        )
        self.policy_head = nn.Linear(128, 1)
        self.candidate_value_head = nn.Linear(128, 1)
        self.state_value_head = nn.Sequential(
            nn.Linear(config.state_dim, 128), nn.ReLU(inplace=False), nn.Linear(128, 1), nn.Tanh()
        )

    def forward(self, board: Tensor, global_features: Tensor, history: Tensor, actions: Tensor):
        board_vector = self.board_encoder(board)
        global_vector = self.global_encoder(global_features)
        _, history_hidden = self.history_encoder(history)
        state_vector = self.state_fusion(torch.cat((board_vector, global_vector, history_hidden[-1]), dim=-1))
        action_vector = self.action_encoder(actions)
        repeated_state = state_vector.unsqueeze(1).expand(-1, actions.shape[1], -1)
        candidate_vector = self.candidate_fusion(torch.cat((repeated_state, action_vector), dim=-1))
        policy_logits = self.policy_head(candidate_vector).squeeze(-1)
        candidate_values = torch.tanh(self.candidate_value_head(candidate_vector).squeeze(-1))
        state_value = self.state_value_head(state_vector).squeeze(-1)
        return policy_logits, candidate_values, state_value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="training-gpu/final_model.pt")
    parser.add_argument("output", type=Path, nargs="?", default=Path("final_model.onnx"))
    args = parser.parse_args()
    if not args.input.is_file():
        raise FileNotFoundError(args.input)

    payload = torch.load(args.input, map_location="cpu", weights_only=False)
    if payload.get("format_version") != 2:
        raise ValueError(f"不支援的模型格式：{payload.get('format_version')}")
    metadata = payload.get("model_metadata") or {}
    if metadata.get("architecture") != "dark_chess_policy_value_resnet_v1":
        raise ValueError(f"不支援的模型架構：{metadata.get('architecture')}")
    model = DarkChessNet(ModelConfig(**(metadata.get("model_config") or {})))
    model.load_state_dict(payload["model_state_dict"], strict=True)
    model.eval()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    candidates = 4
    with torch.inference_mode():
        torch.onnx.export(
            model,
            (
                torch.zeros(1, BOARD_CHANNELS, 4, 8),
                torch.zeros(1, GLOBAL_DIM),
                torch.zeros(1, 8, HISTORY_DIM),
                torch.zeros(1, candidates, ACTION_DIM),
            ),
            args.output,
            input_names=["board", "global_features", "history", "actions"],
            output_names=["policy_logits", "candidate_values", "state_value"],
            dynamic_axes={
                "board": {0: "batch"},
                "global_features": {0: "batch"},
                "history": {0: "batch"},
                "actions": {0: "batch", 1: "candidates"},
                "policy_logits": {0: "batch", 1: "candidates"},
                "candidate_values": {0: "batch", 1: "candidates"},
                "state_value": {0: "batch"},
            },
            opset_version=17,
            do_constant_folding=True,
            dynamo=False,
        )
    print(f"輸入：{args.input.resolve()}")
    print(f"輸出：{args.output.resolve()}")
    print(f"大小：{args.output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
