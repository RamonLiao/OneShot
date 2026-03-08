import { createClient, type Client, type InValue } from "@libsql/client";

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;
  _client = createClient({
    url: process.env.TURSO_DATABASE_URL || "file:dev.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return _client;
}

let _initialized = false;

export async function initDb(): Promise<void> {
  if (_initialized) return;
  const client = getClient();
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      hashedUserId TEXT PRIMARY KEY,
      sessionExpiry INTEGER NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS balances (
      hashedUserId TEXT NOT NULL,
      chainId TEXT NOT NULL,
      deposited INTEGER NOT NULL DEFAULT 0,
      allocated INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hashedUserId, chainId),
      FOREIGN KEY (hashedUserId) REFERENCES users(hashedUserId)
    );

    CREATE TABLE IF NOT EXISTS bets (
      betId TEXT PRIMARY KEY,
      marketId INTEGER NOT NULL,
      hashedUserId TEXT NOT NULL,
      ciphertextHash TEXT NOT NULL,
      ciphertext BLOB NOT NULL,
      amount INTEGER NOT NULL,
      sourceChainId TEXT NOT NULL,
      onchainTxHash TEXT,
      creConfirmed INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (hashedUserId) REFERENCES users(hashedUserId)
    );

    CREATE TABLE IF NOT EXISTS markets (
      marketId INTEGER PRIMARY KEY,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      marketType TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      resultValue INTEGER,
      oracleApiUrl TEXT,
      scalarLow INTEGER,
      scalarHigh INTEGER,
      closeTime INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payouts (
      hashedUserId TEXT NOT NULL,
      marketId INTEGER NOT NULL,
      chainId TEXT NOT NULL,
      amount INTEGER NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0,
      claimTxHash TEXT,
      PRIMARY KEY (hashedUserId, marketId, chainId)
    );
  `);
  _initialized = true;
}

export async function dbGet<T = Record<string, unknown>>(
  sql: string,
  ...args: InValue[]
): Promise<T | undefined> {
  await initDb();
  const result = await getClient().execute({ sql, args });
  return result.rows[0] as T | undefined;
}

export async function dbAll<T = Record<string, unknown>>(
  sql: string,
  ...args: InValue[]
): Promise<T[]> {
  await initDb();
  const result = await getClient().execute({ sql, args });
  return result.rows as T[];
}

export async function dbRun(
  sql: string,
  ...args: InValue[]
): Promise<{ changes: number }> {
  await initDb();
  const result = await getClient().execute({ sql, args });
  return { changes: Number(result.rowsAffected) };
}

export async function dbBatch(
  statements: { sql: string; args: InValue[] }[]
): Promise<void> {
  await initDb();
  await getClient().batch(statements, "write");
}
