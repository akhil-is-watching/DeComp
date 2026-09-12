/**
 * The connector's own state: registered OAuth clients, single-use auth codes, rotating refresh
 * tokens, and the Privy-DID → wallet/account mapping. Access tokens are stateless JWTs and are
 * never stored here (see oauth/tokens.ts).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./env";

mkdirSync(dirname(env.dbPath), { recursive: true });
const db = new Database(env.dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id                  TEXT PRIMARY KEY,
    client_name                TEXT,
    redirect_uris               TEXT NOT NULL, -- JSON array
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
    grant_types                 TEXT NOT NULL, -- JSON array
    created_at                  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_codes (
    code                   TEXT PRIMARY KEY,
    client_id               TEXT NOT NULL REFERENCES oauth_clients(client_id),
    redirect_uri             TEXT NOT NULL,
    code_challenge           TEXT NOT NULL,
    code_challenge_method    TEXT NOT NULL,
    resource                 TEXT,
    user_did                 TEXT NOT NULL,
    used                     INTEGER NOT NULL DEFAULT 0,
    expires_at               INTEGER NOT NULL,
    created_at                INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash    TEXT PRIMARY KEY,
    client_id      TEXT NOT NULL,
    user_did       TEXT NOT NULL,
    resource       TEXT,
    rotated_from   TEXT,
    revoked        INTEGER NOT NULL DEFAULT 0,
    expires_at     INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_did, client_id);
  CREATE TABLE IF NOT EXISTS users (
    did         TEXT PRIMARY KEY,
    wallet_id    TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
`);

export type OAuthClient = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: string;
  grant_types: string;
  created_at: number;
};

export type AuthCode = {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string | null;
  user_did: string;
  used: number;
  expires_at: number;
  created_at: number;
};

export type RefreshToken = {
  token_hash: string;
  client_id: string;
  user_did: string;
  resource: string | null;
  rotated_from: string | null;
  revoked: number;
  expires_at: number;
  created_at: number;
};

export type UserRow = { did: string; wallet_id: string; account_id: string; created_at: number };

export function insertClient(client: Omit<OAuthClient, "created_at">): void {
  db.run(
    `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method, grant_types, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [client.client_id, client.client_name, client.redirect_uris, client.token_endpoint_auth_method, client.grant_types, Date.now()],
  );
}

export function getClient(clientId: string): OAuthClient | undefined {
  return db.query<OAuthClient, [string]>("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) ?? undefined;
}

export function insertAuthCode(row: Omit<AuthCode, "used" | "created_at">): void {
  db.run(
    `INSERT INTO auth_codes (code, client_id, redirect_uri, code_challenge, code_challenge_method, resource, user_did, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.code, row.client_id, row.redirect_uri, row.code_challenge, row.code_challenge_method, row.resource, row.user_did, row.expires_at, Date.now()],
  );
}

/** Atomically marks a code used and returns it, so a race can't redeem the same code twice. */
export function consumeAuthCode(code: string): AuthCode | undefined {
  db.run("DELETE FROM auth_codes WHERE expires_at < ?", [Date.now()]);
  return (
    db
      .query<AuthCode, [string, number]>("UPDATE auth_codes SET used = 1 WHERE code = ? AND used = 0 AND expires_at >= ? RETURNING *")
      .get(code, Date.now()) ?? undefined
  );
}

export function insertRefreshToken(row: Omit<RefreshToken, "revoked" | "created_at">): void {
  db.run(
    `INSERT INTO refresh_tokens (token_hash, client_id, user_did, resource, rotated_from, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.token_hash, row.client_id, row.user_did, row.resource, row.rotated_from, row.expires_at, Date.now()],
  );
}

export function getRefreshToken(tokenHash: string): RefreshToken | undefined {
  return db.query<RefreshToken, [string]>("SELECT * FROM refresh_tokens WHERE token_hash = ?").get(tokenHash) ?? undefined;
}

export function revokeRefreshToken(tokenHash: string): void {
  db.run("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?", [tokenHash]);
}

/** Reuse of an already-rotated token is a signal of theft: revoke every token in its chain. */
export function revokeRefreshChain(userDid: string, clientId: string): void {
  db.run("UPDATE refresh_tokens SET revoked = 1 WHERE user_did = ? AND client_id = ?", [userDid, clientId]);
}

export function getUser(did: string): UserRow | undefined {
  return db.query<UserRow, [string]>("SELECT * FROM users WHERE did = ?").get(did) ?? undefined;
}

export function putUser(did: string, walletId: string, accountId: string): void {
  db.run("INSERT INTO users (did, wallet_id, account_id, created_at) VALUES (?, ?, ?, ?)", [did, walletId, accountId, Date.now()]);
}
