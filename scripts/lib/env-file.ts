import { join } from "node:path";

const ENV_PATH = join(import.meta.dir, "..", "..", ".env");

/** Sets keys in the repo-root .env, replacing existing lines in place and appending new ones. */
export async function upsertEnv(values: Record<string, string>): Promise<void> {
  const file = Bun.file(ENV_PATH);
  const lines = (await file.exists()) ? (await file.text()).split("\n") : [];
  const pending = new Map(Object.entries(values));

  const updated = lines.map(line => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
    if (key && pending.has(key)) {
      const value = pending.get(key)!;
      pending.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  for (const [key, value] of pending) {
    updated.push(`${key}=${value}`);
  }
  await Bun.write(ENV_PATH, updated.join("\n").replace(/\n*$/, "\n"));

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}
