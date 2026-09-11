"""Mandelbrot render on the GPU with MLX, returned as a PNG so the output is visibly real.

Escape-time iteration over every pixel in parallel. Cost scales with width * height * max_iter,
so large renders make a genuinely long-running, meterable job.
"""

from __future__ import annotations

import base64
import hashlib
import json
import struct
import sys
import time
import zlib
from typing import Any


def _png_rgb(pixels: bytes, width: int, height: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    stride = width * 3
    raw = b"".join(b"\x00" + pixels[y * stride : (y + 1) * stride] for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


def run(params: dict[str, Any]) -> dict[str, Any]:
    import mlx.core as mx
    import numpy as np

    device = str(mx.default_device())
    if "gpu" not in device:
        raise RuntimeError(f"MLX default device is {device}, expected a GPU")

    width, height, max_iter = params["width"], params["height"], params["max_iter"]
    cx, cy, span = params["center_x"], params["center_y"], params["span"]
    aspect = height / width

    xs = mx.linspace(cx - span / 2, cx + span / 2, width)
    ys = mx.linspace(cy - span * aspect / 2, cy + span * aspect / 2, height)
    c_re = mx.broadcast_to(xs[None, :], (height, width))
    c_im = mx.broadcast_to(ys[:, None], (height, width))
    z_re = mx.zeros((height, width))
    z_im = mx.zeros((height, width))
    alive = mx.ones((height, width), dtype=mx.bool_)
    counts = mx.zeros((height, width))

    t0 = time.perf_counter()
    for i in range(max_iter):
        z_re, z_im = z_re * z_re - z_im * z_im + c_re, 2 * z_re * z_im + c_im
        alive = mx.logical_and(alive, z_re * z_re + z_im * z_im <= 4.0)
        counts = counts + alive
        # Park escaped points at the origin so they never overflow to inf/nan.
        z_re = mx.where(alive, z_re, 0.0)
        z_im = mx.where(alive, z_im, 0.0)
        if i % 32 == 31:
            mx.eval(z_re, z_im, alive, counts)  # bound the lazy graph

    t = counts / max_iter
    rgb = mx.stack([9 * (1 - t) * t**3, 15 * (1 - t) ** 2 * t**2, 8.5 * (1 - t) ** 3 * t], axis=-1)
    rgb = mx.where(alive[..., None], 0.0, mx.clip(rgb, 0.0, 1.0))
    pixels = (rgb * 255).astype(mx.uint8)
    mx.eval(pixels, alive)
    compute_s = time.perf_counter() - t0

    png = _png_rgb(np.array(pixels).tobytes(), width, height)
    return {
        "job_type": "mandelbrot",
        "device": device,
        "width": width,
        "height": height,
        "max_iter": max_iter,
        "compute_s": round(compute_s, 3),
        "inside_fraction": round(float(mx.mean(alive).item()), 6),
        "png_sha256": hashlib.sha256(png).hexdigest(),
        "png_base64": base64.b64encode(png).decode(),
    }


if __name__ == "__main__":
    print(json.dumps(run(json.load(sys.stdin))))
