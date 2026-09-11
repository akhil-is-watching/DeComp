"""The fixed job menu. Only these job types can run; params are validated and clamped here.

Jobs run as separate processes (`python -m <module>`), reading params as JSON on stdin and
printing a single JSON result line on stdout. That keeps them killable without touching the
runner, which is the sandboxing model (Docker on macOS can't reach the Metal GPU).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class JobSpec:
    module: str
    validate: Callable[[dict[str, Any]], dict[str, Any]]
    description: str


def _validate_benchmark(params: dict[str, Any]) -> dict[str, Any]:
    backend = params.get("backend", "mlx")
    if backend not in ("mlx", "torch"):
        raise ValueError("backend must be 'mlx' or 'torch'")
    size = int(params.get("size", 2048))
    if size not in (512, 1024, 2048, 4096):
        raise ValueError("size must be one of 512, 1024, 2048, 4096")
    duration_s = float(params.get("duration_s", 5))
    if not 0.5 <= duration_s <= 600:
        raise ValueError("duration_s must be between 0.5 and 600")
    return {"backend": backend, "size": size, "duration_s": duration_s, "seed": int(params.get("seed", 0))}


MENU: dict[str, JobSpec] = {
    "benchmark": JobSpec(
        module="jobs.benchmark",
        validate=_validate_benchmark,
        description="Dense matmul loop on the Apple GPU (MLX or PyTorch MPS)",
    ),
}
