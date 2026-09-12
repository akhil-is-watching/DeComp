import { describe, expect, test } from "bun:test";
import { validateJobParams } from "../src/mcp/validate-params";

describe("benchmark", () => {
  test("defaults are valid", () => {
    expect(validateJobParams("benchmark", {})).toEqual({ ok: true, params: { backend: "mlx", size: 2048, duration_s: 5, seed: 0 } });
  });
  test("rejects an unknown backend", () => {
    expect(validateJobParams("benchmark", { backend: "cuda" })).toEqual({ ok: false, error: "backend must be 'mlx' or 'torch'" });
  });
  test("rejects an off-menu size", () => {
    expect(validateJobParams("benchmark", { size: 3000 })).toEqual({ ok: false, error: "size must be one of 512, 1024, 2048, 4096" });
  });
  test("rejects duration_s above 600", () => {
    expect(validateJobParams("benchmark", { duration_s: 601 })).toEqual({ ok: false, error: "duration_s must be between 0.5 and 600" });
  });
  test("accepts the boundary values", () => {
    expect(validateJobParams("benchmark", { duration_s: 0.5 }).ok).toBe(true);
    expect(validateJobParams("benchmark", { duration_s: 600 }).ok).toBe(true);
  });
});

describe("mandelbrot", () => {
  test("defaults are valid", () => {
    expect(validateJobParams("mandelbrot", {})).toEqual({
      ok: true,
      params: { width: 512, height: 512, max_iter: 500, center_x: -0.6, center_y: 0, span: 3.2 },
    });
  });
  test("height defaults to width when omitted", () => {
    const result = validateJobParams("mandelbrot", { width: 1024 });
    expect(result.ok && result.params.height).toBe(1024);
  });
  test("rejects width above 4096", () => {
    expect(validateJobParams("mandelbrot", { width: 5000 }).ok).toBe(false);
  });
  test("rejects max_iter below 16", () => {
    expect(validateJobParams("mandelbrot", { max_iter: 1 }).ok).toBe(false);
  });
  test("rejects a non-finite center", () => {
    expect(validateJobParams("mandelbrot", { center_x: Infinity }).ok).toBe(false);
  });
  test("rejects span outside (0, 8]", () => {
    expect(validateJobParams("mandelbrot", { span: 0 }).ok).toBe(false);
    expect(validateJobParams("mandelbrot", { span: 9 }).ok).toBe(false);
    expect(validateJobParams("mandelbrot", { span: 8 }).ok).toBe(true);
  });
});

test("an unknown jobType is rejected", () => {
  expect(validateJobParams("sdxl", {})).toEqual({ ok: false, error: "jobType must be one of benchmark, mandelbrot" });
});
