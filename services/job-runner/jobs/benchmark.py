"""Benchmark job: repeated dense matmul on the GPU for a fixed duration.

Refuses to run on CPU, so a successful result is proof the work hit the GPU.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any


def _run_mlx(size: int, duration_s: float, seed: int) -> dict[str, Any]:
    import mlx.core as mx

    device = str(mx.default_device())
    if "gpu" not in device:
        raise RuntimeError(f"MLX default device is {device}, expected a GPU")
    mx.random.seed(seed)
    a = mx.random.normal((size, size))
    b = mx.random.normal((size, size))
    mx.eval(a, b)

    iterations = 0
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < duration_s:
        c = a @ b
        mx.eval(c)
        iterations += 1
    compute_s = time.perf_counter() - t0
    return {"device": device, "iterations": iterations, "compute_s": compute_s, "checksum": float(mx.sum(c).item())}


def _run_torch(size: int, duration_s: float, seed: int) -> dict[str, Any]:
    import torch

    if not torch.backends.mps.is_available():
        raise RuntimeError("PyTorch MPS backend is not available")
    device = torch.device("mps")
    generator = torch.Generator().manual_seed(seed)
    a = torch.randn(size, size, generator=generator).to(device)
    b = torch.randn(size, size, generator=generator).to(device)
    torch.mps.synchronize()

    iterations = 0
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < duration_s:
        c = a @ b
        torch.mps.synchronize()
        iterations += 1
    compute_s = time.perf_counter() - t0
    return {"device": "mps", "iterations": iterations, "compute_s": compute_s, "checksum": float(c.sum().item())}


def run(params: dict[str, Any]) -> dict[str, Any]:
    size, duration_s, seed = params["size"], params["duration_s"], params["seed"]
    runner = _run_mlx if params["backend"] == "mlx" else _run_torch
    out = runner(size, duration_s, seed)
    # Each n x n matmul is ~2n^3 floating point ops.
    gflops = out["iterations"] * 2 * size**3 / out["compute_s"] / 1e9
    return {
        "job_type": "benchmark",
        "backend": params["backend"],
        "size": size,
        **out,
        "compute_s": round(out["compute_s"], 3),
        "gflops": round(gflops, 1),
    }


if __name__ == "__main__":
    print(json.dumps(run(json.load(sys.stdin))))
