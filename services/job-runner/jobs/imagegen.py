"""Seeded plasma-art image generation on the GPU with MLX, returned as a PNG asset.

Same shape as mandelbrot.py (GPU compute -> PNG -> base64 in the result) but generates
an abstract image from a seed instead of rendering a fixed fractal, so it stands in for
an "image/asset generation" job without pulling in a diffusion model or an external API.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import sys
import time
from typing import Any

from jobs.pngutil import encode_png_rgb


def run(params: dict[str, Any]) -> dict[str, Any]:
    import mlx.core as mx
    import numpy as np

    device = str(mx.default_device())
    if "gpu" not in device:
        raise RuntimeError(f"MLX default device is {device}, expected a GPU")

    width, height, seed = params["width"], params["height"], params["seed"]

    t0 = time.perf_counter()
    mx.random.seed(seed)
    # Random phase/frequency offsets per seed so each seed yields a visually distinct pattern.
    phases = mx.random.uniform(0, 2 * math.pi, (5,))
    freqs = mx.random.uniform(4.0, 12.0, (3,))

    xs = mx.linspace(0, 1, width)
    ys = mx.linspace(0, 1, height)
    x = mx.broadcast_to(xs[None, :], (height, width))
    y = mx.broadcast_to(ys[:, None], (height, width))
    r = mx.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2)

    plasma = (
        mx.sin(x * freqs[0] + phases[0])
        + mx.sin(y * freqs[1] + phases[1])
        + mx.sin((x + y) * freqs[2] + phases[2])
        + mx.sin(r * 16 + phases[3])
    ) / 4.0
    hue = (plasma + 1) / 2  # normalize to [0, 1]

    rgb = mx.stack(
        [
            mx.sin(hue * 2 * math.pi + phases[4]) * 0.5 + 0.5,
            mx.sin(hue * 2 * math.pi + phases[4] + 2.0944) * 0.5 + 0.5,  # +120deg
            mx.sin(hue * 2 * math.pi + phases[4] + 4.1888) * 0.5 + 0.5,  # +240deg
        ],
        axis=-1,
    )
    pixels = (mx.clip(rgb, 0.0, 1.0) * 255).astype(mx.uint8)
    mx.eval(pixels)
    compute_s = time.perf_counter() - t0

    png = encode_png_rgb(np.array(pixels).tobytes(), width, height)
    return {
        "job_type": "imagegen",
        "device": device,
        "width": width,
        "height": height,
        "seed": seed,
        "compute_s": round(compute_s, 3),
        "png_sha256": hashlib.sha256(png).hexdigest(),
        "png_base64": base64.b64encode(png).decode(),
    }


if __name__ == "__main__":
    print(json.dumps(run(json.load(sys.stdin))))
