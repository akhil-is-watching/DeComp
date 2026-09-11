import { describe, expect, test } from "bun:test";
import { hbarPrice, parseOffers, priceIn, tickAmount } from "../src/pricing";

const TOKEN = "0.0.5005";

describe("parseOffers", () => {
  test("prices job types per second in HBAR", () => {
    const offers = parseOffers("benchmark:2000000,mandelbrot:3000000", 5);
    expect(offers.get("mandelbrot")).toEqual({ jobType: "mandelbrot", tickSeconds: 5, prices: [{ asset: "0.0.0", perSecond: 3000000n }] });
  });

  test("adds a token price to every job type when a compute token is configured", () => {
    const offer = parseOffers("benchmark:2000000,mandelbrot:3000000", 5, { tokenId: TOKEN, spec: "benchmark:4,mandelbrot:6" }).get("benchmark")!;
    expect(priceIn(offer, TOKEN)).toEqual({ asset: TOKEN, perSecond: 4n });
    expect(hbarPrice(offer).perSecond).toBe(2000000n);
  });

  test("requires token pricing for every HBAR-priced job type", () => {
    expect(() => parseOffers("benchmark:1,mandelbrot:1", 5, { tokenId: TOKEN, spec: "benchmark:4" })).toThrow("no price for mandelbrot");
  });

  test("rejects token prices for job types without an HBAR price", () => {
    expect(() => parseOffers("benchmark:1", 5, { tokenId: TOKEN, spec: "benchmark:4,upscale:9" })).toThrow("upscale");
  });

  test.each([["benchmark:0"], ["benchmark:1.5"], ["benchmark"], [""]])("rejects PROVIDER_OFFERS %p", spec => {
    expect(() => parseOffers(spec, 5)).toThrow();
  });

  test("rejects a fractional tick length", () => {
    expect(() => parseOffers("benchmark:1", 2.5)).toThrow("TICK_SECONDS");
  });
});

test("a tick costs the per-second price times the tick length", () => {
  expect(tickAmount({ asset: TOKEN, perSecond: 5n }, 5)).toBe(25n);
});
