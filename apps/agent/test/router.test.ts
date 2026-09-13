import { describe, expect, mock, test } from "bun:test";
import { ProviderUnavailableError, rankCandidates, routeWithFallback, type Candidate } from "../src/router";

function candidate(providerId: string, pricePerSecTinybars: bigint, registeredAt = "1789151420.0", tickSeconds = 5): Candidate {
  const n = Number(providerId.replace(/\D/g, ""));
  return {
    providerId,
    hederaAccount: `0.0.${1000 + n}`,
    endpoint: `http://127.0.0.1:${4020 + n}`,
    pricePerSecTinybars,
    tickSeconds,
    registeredAt,
  };
}

describe("rankCandidates", () => {
  test("picks the cheapest per-second price, not the first listed", () => {
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

  test("at equal price, the smaller tick wins", () => {
    const ranked = rankCandidates([candidate("P1", 10n, "1789151999.0", 10), candidate("P2", 10n, "1789151420.0", 5)]);
    expect(ranked[0]!.providerId).toBe("P2");
  });

  test("at equal price and tick, the most recent registration wins", () => {
    const ranked = rankCandidates([candidate("P1", 10n, "1789151420.5"), candidate("P2", 10n, "1789151999.0")]);
    expect(ranked[0]!.providerId).toBe("P2");
  });

  test("drops providers above the per-second price ceiling", () => {
    const ranked = rankCandidates([candidate("P1", 30n), candidate("P2", 10n)], { maxPricePerSecTinybars: 20n });
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
    await expect(routeWithFallback(ranked, attempt)).rejects.toThrow("tried: P1 (timeout); P2 (timeout); P3 (timeout)");
  });

  test("says why each provider was skipped, not just which", async () => {
    const attempt = async (c: Candidate): Promise<string> => {
      throw new ProviderUnavailableError(c.endpoint, new Error(c.providerId === "P1" ? "not connected to the bridge" : "one tick costs too much"));
    };
    const routed = routeWithFallback(ranked.slice(0, 2), attempt);
    await expect(routed).rejects.toThrow("P1 (not connected to the bridge)");
    await expect(routed).rejects.toThrow("P2 (one tick costs too much)");
  });

  test("says no provider is online when there was nobody to try", async () => {
    await expect(routeWithFallback([], async () => "never")).rejects.toThrow("no eligible provider is online");
  });
});
