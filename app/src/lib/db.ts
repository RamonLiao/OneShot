import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DATABASE_URL?.replace("file:", "") || path.join(process.cwd(), "dev.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initTables(_db);
  return _db;
}

function initTables(db: Database.Database) {
  db.exec(`
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
}
