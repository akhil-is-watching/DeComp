/**
 * Mirrors services/job-runner/jobs/__init__.py's validators exactly, so a bad prompt fails fast
 * here with a clear message instead of reaching the runner and coming back as an opaque 422.
 */

export type ValidationResult = { ok: true; params: Record<string, unknown> } | { ok: false; error: string };

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return value === undefined ? fallback : Number(value);
}

function validateBenchmark(params: Record<string, unknown>): ValidationResult {
  const backend = params.backend ?? "mlx";
  if (backend !== "mlx" && backend !== "torch") return { ok: false, error: "backend must be 'mlx' or 'torch'" };
  const size = Math.trunc(num(params, "size", 2048));
  if (![512, 1024, 2048, 4096].includes(size)) return { ok: false, error: "size must be one of 512, 1024, 2048, 4096" };
  const durationS = num(params, "duration_s", 5);
  if (!(durationS >= 0.5 && durationS <= 600)) return { ok: false, error: "duration_s must be between 0.5 and 600" };
  return { ok: true, params: { backend, size, duration_s: durationS, seed: Math.trunc(num(params, "seed", 0)) } };
}

function validateMandelbrot(params: Record<string, unknown>): ValidationResult {
  const width = Math.trunc(num(params, "width", 512));
  const height = Math.trunc(num(params, "height", width));
  if (!(width >= 64 && width <= 4096 && height >= 64 && height <= 4096)) {
    return { ok: false, error: "width and height must be between 64 and 4096" };
  }
  const maxIter = Math.trunc(num(params, "max_iter", 500));
  if (!(maxIter >= 16 && maxIter <= 20000)) return { ok: false, error: "max_iter must be between 16 and 20000" };
  const centerX = num(params, "center_x", -0.6);
  const centerY = num(params, "center_y", 0.0);
  const span = num(params, "span", 3.2);
  if (![centerX, centerY, span].every(Number.isFinite) || !(span > 0 && span <= 8)) {
    return { ok: false, error: "center_x and center_y must be finite and span must be in (0, 8]" };
  }
  return { ok: true, params: { width, height, max_iter: maxIter, center_x: centerX, center_y: centerY, span } };
}

const VALIDATORS: Record<string, (params: Record<string, unknown>) => ValidationResult> = {
  benchmark: validateBenchmark,
  mandelbrot: validateMandelbrot,
};

export function validateJobParams(jobType: string, params: Record<string, unknown>): ValidationResult {
  const validator = VALIDATORS[jobType];
  if (!validator) return { ok: false, error: `jobType must be one of ${Object.keys(VALIDATORS).join(", ")}` };
  return validator(params);
}
