import { describe, expect, mock, test } from "bun:test";
import { ProviderUnavailableError, rankCandidates, routeWithFallback, type Candidate } from "../src/router";

function candidate(providerId: string, priceTinybars: bigint, registeredAt = "1789151420.0"): Candidate {
  return {
    providerId,
    hederaAccount: `0.0.${1000 + Number(providerId.replace(/\D/g, ""))}`,
    endpoint: `http://127.0.0.1:40${providerId.replace(/\D/g, "").padStart(2, "0")}`,
    priceTinybars,
    registeredAt,
  };
}

describe("rankCandidates", () => {
  test("picks the cheapest, not the first listed", () => {
    const ranked = rankCandidates([candidate("P1", 30n), candidate("P2", 10n), candidate("P3", 20n)]);
    expect(ranked.map(c => c.providerId)).toEqual(["P2", "P3", "P1"]);
  });

  test("the cheapest wins regardless of input order", () => {
    const pool = [candidate("P1", 30n), candidate("P2", 10n), candidate("P3", 20n), candidate("P4", 25n)];
    for (let i = 0; i < pool.length; i++) {
      const rotated = [...pool.slice(i), ...pool.slice(0, i)];
      expect(rankCandidates(rotated)[0]!.providerId).toBe("P2");
    }
  });

  test("breaks price ties by most recent registration", () => {
    const ranked = rankCandidates([candidate("P1", 10n, "1789151420.5"), candidate("P2", 10n, "1789151999.0")]);
    expect(ranked[0]!.providerId).toBe("P2");
  });

  test("drops providers above the price ceiling", () => {
    const ranked = rankCandidates([candidate("P1", 30n), candidate("P2", 10n)], { maxPriceTinybars: 20n });
    expect(ranked.map(c => c.providerId)).toEqual(["P2"]);
  });

  test("returns nothing when no provider is eligible", () => {
    expect(rankCandidates([])).toEqual([]);
  });
});

describe("routeWithFallback", () => {
  const ranked = [candidate("P1", 10n), candidate("P2", 20n), candidate("P3", 30n)];

  test("uses the cheapest provider when it is up", async () => {
    const attempt = mock(async (c: Candidate) => c.providerId);
    const { candidate: chosen, skipped } = await routeWithFallback(ranked, attempt);
    expect(chosen.providerId).toBe("P1");
    expect(skipped).toEqual([]);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test("falls back to the next-cheapest when a provider is unreachable", async () => {
    const attempt = mock(async (c: Candidate) => {
      if (c.providerId === "P1") throw new ProviderUnavailableError(c.endpoint, new Error("ECONNREFUSED"));
      return c.providerId;
    });
    const onFallback = mock(() => {});
    const { candidate: chosen, skipped } = await routeWithFallback(ranked, attempt, onFallback);
    expect(chosen.providerId).toBe("P2");
    expect(skipped.map(s => s.candidate.providerId)).toEqual(["P1"]);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  test("does not retry elsewhere after a failure that may have involved payment", async () => {
    const attempt = mock(async (c: Candidate) => {
      if (c.providerId === "P1") throw new Error("job was not accepted: HTTP 402");
      return c.providerId;
    });
    await expect(routeWithFallback(ranked, attempt)).rejects.toThrow("HTTP 402");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test("reports every provider tried when all are unreachable", async () => {
    const attempt = async (c: Candidate): Promise<string> => {
      throw new ProviderUnavailableError(c.endpoint, new Error("timeout"));
    };
    await expect(routeWithFallback(ranked, attempt)).rejects.toThrow("tried: P1, P2, P3");
  });
});
