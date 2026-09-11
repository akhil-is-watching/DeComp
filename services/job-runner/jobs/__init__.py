"""The fixed job menu. Only these job types can run; params are validated and clamped here.

Jobs run as separate processes (`python -m <module>`), reading params as JSON on stdin and
printing a single JSON result line on stdout. That keeps them killable without touching the
runner, which is the sandboxing model (Docker on macOS can't reach the Metal GPU).
"""

from __future__ import annotations

import math
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


def _validate_mandelbrot(params: dict[str, Any]) -> dict[str, Any]:
    width = int(params.get("width", 512))
    height = int(params.get("height", width))
    if not (64 <= width <= 4096 and 64 <= height <= 4096):
        raise ValueError("width and height must be between 64 and 4096")
    max_iter = int(params.get("max_iter", 500))
    if not 16 <= max_iter <= 20000:
        raise ValueError("max_iter must be between 16 and 20000")
    center_x = float(params.get("center_x", -0.6))
    center_y = float(params.get("center_y", 0.0))
    span = float(params.get("span", 3.2))
    if not all(math.isfinite(v) for v in (center_x, center_y, span)) or not 0 < span <= 8:
        raise ValueError("center_x and center_y must be finite and span must be in (0, 8]")
    return {"width": width, "height": height, "max_iter": max_iter, "center_x": center_x, "center_y": center_y, "span": span}


MENU: dict[str, JobSpec] = {
    "benchmark": JobSpec(
        module="jobs.benchmark",
        validate=_validate_benchmark,
        description="Dense matmul loop on the Apple GPU (MLX or PyTorch MPS)",
    ),
    "mandelbrot": JobSpec(
        module="jobs.mandelbrot",
        validate=_validate_mandelbrot,
        description="Mandelbrot render on the GPU with MLX, returned as a PNG",
    ),
}
