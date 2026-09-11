import type { JobSummary } from "@decomp/agent";

/** PASS/FAIL recorder shared by the phase gates. */
export function createGate(phase: number) {
  let failures = 0;
  return {
    record(name: string, ok: boolean, detail: string) {
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
    },
    finish(): never {
      console.log(failures ? `\n${failures} check(s) failed — fix before Phase ${phase + 1}.` : `\nPhase ${phase} gate passed.`);
      process.exit(failures ? 1 : 0);
    },
  };
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Every payment reached consensus with SUCCESS and credited the provider exactly its amount. */
export function allPaymentsSettled(summary: JobSummary): boolean {
  return (
    summary.payments.length > 0 &&
    summary.payments.every(p => p.mirror?.result === "SUCCESS" && BigInt(p.mirror.credited) === BigInt(p.amount))
  );
}
