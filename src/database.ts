import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "neuraltrace.db");
const SYSTEM_DB_PATH = path.join(DATA_DIR, "system.db");
const VAULTS_DIR = path.join(DATA_DIR, "vaults");

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Global vault DB (selfhosted single-user) ───

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

// ─── Per-user vault DB (cloud multi-tenant) ───

const vaultCache = new Map<string, Database.Database>();

/**
 * Gets or creates an isolated vault DB for a specific user.
 * Vault files live at data/vaults/{userId}.db
 */
export function getVaultDb(userId: string): Database.Database {
  const cached = vaultCache.get(userId);
  if (cached) return cached;

  fs.mkdirSync(VAULTS_DIR, { recursive: true });
  const vaultPath = path.join(VAULTS_DIR, `${userId}.db`);
  const isNew = !fs.existsSync(vaultPath);
  const vaultDb = new Database(vaultPath);
  vaultDb.pragma("journal_mode = WAL");
  initSchema(vaultDb);
  vaultCache.set(userId, vaultDb);

  if (isNew) {
    console.log(`[Vault] Created vault for user ${userId}`);
  } else {
    console.log(`[Vault] Opened vault for ${userId}`);
  }

  return vaultDb;
}

/**
 * Resolves the correct DB for a request.
 * Cloud mode (userId set) → per-user vault. Selfhosted (no userId) → global DB.
 */
export function resolveDb(userId?: string): Database.Database {
  return userId ? getVaultDb(userId) : getDb();
}

/**
 * Returns the number of vault files in data/vaults/
 */
export function getVaultCount(): number {
  if (!fs.existsSync(VAULTS_DIR)) return 0;
  return fs.readdirSync(VAULTS_DIR).filter(f => f.endsWith(".db")).length;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      tags TEXT,
      vector TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // M001 migration: add consolidation columns (safe to re-run)
  const columns = db.prepare("PRAGMA table_info(traces)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map(c => c.name));

  if (!columnNames.has("type")) {
    db.exec("ALTER TABLE traces ADD COLUMN type TEXT DEFAULT 'raw'");
    console.log("[Migration] Added 'type' column to traces");
  }
  if (!columnNames.has("source")) {
    db.exec("ALTER TABLE traces ADD COLUMN source TEXT");
    console.log("[Migration] Added 'source' column to traces");
  }
  if (!columnNames.has("processed")) {
    db.exec("ALTER TABLE traces ADD COLUMN processed INTEGER DEFAULT 0");
    console.log("[Migration] Added 'processed' column to traces");
  }
  if (!columnNames.has("consolidated_from")) {
    db.exec("ALTER TABLE traces ADD COLUMN consolidated_from TEXT");
    console.log("[Migration] Added 'consolidated_from' column to traces");
  }
  if (!columnNames.has("metadata")) {
    db.exec("ALTER TABLE traces ADD COLUMN metadata TEXT");
    console.log("[Migration] Added 'metadata' column to traces");
  }
}

// --- Trace types ---

export interface Trace {
  id: number;
  content: string;
  tags: string | null;
  vector: string | null;
  created_at: string;
  type: string;
  source: string | null;
  processed: number;
  consolidated_from: string | null;
  metadata: string | null;
}

export interface TraceBasic {
  id: number;
  content: string;
  tags: string | null;
  created_at: string;
}

// --- Query helpers ---

export function insertTrace(
  content: string,
  tags: string,
  vector?: string,
  type: string = "raw",
  source?: string,
  db?: Database.Database
): number {
  const d = db || getDb();
  const stmt = d.prepare(
    "INSERT INTO traces (content, tags, vector, type, source, processed) VALUES (?, ?, ?, ?, ?, 0)"
  );
  const result = stmt.run(content, tags || null, vector || null, type, source || null);
  return Number(result.lastInsertRowid);
}

export function searchTraces(query: string, limit = 10, db?: Database.Database): TraceBasic[] {
  const d = db || getDb();
  const stmt = d.prepare(
    "SELECT id, content, tags, created_at FROM traces WHERE content LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT ?"
  );
  return stmt.all(`%${query}%`, `%${query}%`, limit) as TraceBasic[];
}

export function getRecentTraces(limit = 10, db?: Database.Database): TraceBasic[] {
  const d = db || getDb();
  const stmt = d.prepare(
    "SELECT id, content, tags, created_at FROM traces ORDER BY created_at DESC LIMIT ?"
  );
  return stmt.all(limit) as TraceBasic[];
}

export function getTraceCount(db?: Database.Database): number {
  const d = db || getDb();
  const row = d.prepare("SELECT COUNT(*) as count FROM traces").get() as { count: number };
  return row.count;
}

export function deleteTrace(id: number, db?: Database.Database): boolean {
  const d = db || getDb();
  const stmt = d.prepare("DELETE FROM traces WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

export function updateTraceMetadata(id: number, metadata: string, db?: Database.Database): boolean {
  const d = db || getDb();
  const result = d.prepare("UPDATE traces SET metadata = ? WHERE id = ?").run(metadata, id);
  return result.changes > 0;
}

export function getTraceById(id: number, db?: Database.Database): Trace | null {
  const d = db || getDb();
  const row = d.prepare("SELECT * FROM traces WHERE id = ?").get(id);
  return (row as Trace) || null;
}

export function getAllTraces(db?: Database.Database): Array<{
  id: number;
  content: string;
  tags: string | null;
  vector: string | null;
  created_at: string;
  metadata: string | null;
}> {
  const d = db || getDb();
  const stmt = d.prepare(
    "SELECT id, content, tags, vector, created_at, metadata FROM traces ORDER BY created_at DESC"
  );
  return stmt.all() as Array<{
    id: number;
    content: string;
    tags: string | null;
    vector: string | null;
    created_at: string;
    metadata: string | null;
  }>;
}

export function searchTracesFiltered(options: {
  query?: string;
  tags?: string;
  after?: string;
  before?: string;
  limit?: number;
}, db?: Database.Database): Array<{
  id: number;
  content: string;
  tags: string | null;
  vector: string | null;
  created_at: string;
}> {
  const d = db || getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.query) {
    conditions.push("(content LIKE ? OR tags LIKE ?)");
    params.push(`%${options.query}%`, `%${options.query}%`);
  }
  if (options.tags) {
    const tagList = options.tags.split(",").map(t => t.trim()).filter(Boolean);
    const tagConditions = tagList.map(() => "tags LIKE ?");
    conditions.push(`(${tagConditions.join(" OR ")})`);
    tagList.forEach(t => params.push(`%${t}%`));
  }
  if (options.after) {
    conditions.push("created_at >= ?");
    params.push(options.after);
  }
  if (options.before) {
    conditions.push("created_at <= ?");
    params.push(options.before);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit || 50;
  params.push(limit);

  const stmt = d.prepare(
    `SELECT id, content, tags, vector, created_at, metadata FROM traces ${where} ORDER BY created_at DESC LIMIT ?`
  );
  return stmt.all(...params) as Array<{
    id: number;
    content: string;
    tags: string | null;
    vector: string | null;
    created_at: string;
  }>;
}

// --- Consolidation helpers (M001) ---

export function getUnprocessedTraces(limit = 20, db?: Database.Database): Trace[] {
  const d = db || getDb();
  const stmt = d.prepare(
    "SELECT id, content, tags, vector, created_at, type, source, processed, consolidated_from FROM traces WHERE type = 'raw' AND processed = 0 ORDER BY created_at DESC LIMIT ?"
  );
  return stmt.all(limit) as Trace[];
}

export function markAsProcessed(ids: number[], db?: Database.Database): number {
  if (ids.length === 0) return 0;
  const d = db || getDb();
  const placeholders = ids.map(() => "?").join(",");
  const stmt = d.prepare(
    `UPDATE traces SET processed = 1 WHERE id IN (${placeholders})`
  );
  const result = stmt.run(...ids);
  return result.changes;
}

export function insertConsolidatedTrace(
  content: string,
  tags: string,
  vector: string | null,
  type: string,
  sourceIds: number[],
  db?: Database.Database
): number {
  const d = db || getDb();
  const stmt = d.prepare(
    "INSERT INTO traces (content, tags, vector, type, source, processed, consolidated_from) VALUES (?, ?, ?, ?, 'consolidator', 1, ?)"
  );
  const consolidatedFrom = sourceIds.join(",");
  const result = stmt.run(content, tags || null, vector, type, consolidatedFrom);
  return Number(result.lastInsertRowid);
}

// ─── System Database (users, api_keys, magic_tokens) ───

let systemDb: Database.Database;

export function getSystemDb(): Database.Database {
  if (!systemDb) {
    systemDb = new Database(SYSTEM_DB_PATH);
    systemDb.pragma("journal_mode = WAL");
  }
  return systemDb;
}

export function initSystemDb(): void {
  const sdb = getSystemDb();
  sdb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      plan TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT 'default',
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS magic_tokens (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // OAuth 2.1 tables (additive — safe to re-run)
  sdb.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT,
      redirect_uris TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT DEFAULT 'S256',
      scope TEXT DEFAULT 'vault',
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT DEFAULT 'vault',
      expires_at TEXT NOT NULL,
      refresh_token_hash TEXT,
      refresh_expires_at TEXT,
      revoked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  console.log("[SystemDB] Initialized (users, api_keys, magic_tokens, oauth)");

  // M003/S02 migration: add daily search counter columns to users table
  const userCols = sdb.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const userColNames = new Set(userCols.map(c => c.name));

  if (!userColNames.has("daily_search_count")) {
    sdb.exec("ALTER TABLE users ADD COLUMN daily_search_count INTEGER DEFAULT 0");
    console.log("[Migration] Added 'daily_search_count' column to users");
  }
  if (!userColNames.has("daily_search_reset")) {
    sdb.exec("ALTER TABLE users ADD COLUMN daily_search_reset TEXT");
    console.log("[Migration] Added 'daily_search_reset' column to users");
  }

  // M003/S03 migration: add Paddle billing columns to users table
  if (!userColNames.has("paddle_customer_id")) {
    sdb.exec("ALTER TABLE users ADD COLUMN paddle_customer_id TEXT");
    console.log("[Migration] Added 'paddle_customer_id' column to users");
  }
  if (!userColNames.has("paddle_subscription_id")) {
    sdb.exec("ALTER TABLE users ADD COLUMN paddle_subscription_id TEXT");
    console.log("[Migration] Added 'paddle_subscription_id' column to users");
  }
}

// --- System DB types ---

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  created_at: string;
  updated_at: string;
  daily_search_count: number;
  daily_search_reset: string | null;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  name: string;
  last_used_at: string | null;
  created_at: string;
}

export interface MagicTokenRow {
  id: string;
  email: string;
  token_hash: string;
  expires_at: string;
  used: number;
  created_at: string;
}

// --- System DB query helpers ---

export function createUser(email: string): UserRow {
  const sdb = getSystemDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  sdb.prepare(
    "INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, email.toLowerCase(), now, now);
  return findUserById(id)!;
}

export function findUserByEmail(email: string): UserRow | null {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  return (row as UserRow) || null;
}

export function findUserById(id: string): UserRow | null {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return (row as UserRow) || null;
}

export function storeMagicToken(email: string, tokenHash: string, expiresAt: string): string {
  const sdb = getSystemDb();
  const id = crypto.randomUUID();
  sdb.prepare(
    "INSERT INTO magic_tokens (id, email, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).run(id, email.toLowerCase(), tokenHash, expiresAt);
  return id;
}

export function findMagicToken(tokenHash: string): MagicTokenRow | null {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT * FROM magic_tokens WHERE token_hash = ?").get(tokenHash);
  return (row as MagicTokenRow) || null;
}

export function markMagicTokenUsed(id: string): void {
  const sdb = getSystemDb();
  sdb.prepare("UPDATE magic_tokens SET used = 1 WHERE id = ?").run(id);
}

/**
 * Creates a new API key for a user.
 * Returns the raw key (shown once to user) and the stored row.
 * Key format: nt_ + 32 hex chars. Only the SHA-256 hash is stored.
 */
export function createApiKey(userId: string, name = "default"): { rawKey: string; row: ApiKeyRow } {
  const sdb = getSystemDb();
  const id = crypto.randomUUID();
  const rawKey = `nt_${crypto.randomBytes(16).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  sdb.prepare(
    "INSERT INTO api_keys (id, user_id, key_hash, name) VALUES (?, ?, ?, ?)"
  ).run(id, userId, keyHash, name);
  const row = sdb.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow;
  return { rawKey, row };
}

export function findUserByApiKey(keyHash: string): UserRow | null {
  const sdb = getSystemDb();
  const apiKey = sdb.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(keyHash) as ApiKeyRow | undefined;
  if (!apiKey) return null;
  return findUserById(apiKey.user_id);
}

export function touchApiKey(keyHash: string): void {
  const sdb = getSystemDb();
  const now = new Date().toISOString();
  sdb.prepare("UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?").run(now, keyHash);
}

export function getSystemUserCount(): number {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

// ─── Rate Limit Counter Functions (M003/S02) ───

// ─── OAuth Database Helpers ───

export function upsertOAuthClient(clientId: string, clientName: string, redirectUris: string[]): void {
  const sdb = getSystemDb();
  sdb.prepare(
    "INSERT OR REPLACE INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)"
  ).run(clientId, clientName, JSON.stringify(redirectUris));
}

export function findOAuthClient(clientId: string): { client_id: string; client_name: string; redirect_uris: string } | null {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId);
  return (row as any) || null;
}

export function storeOAuthCode(code: string, clientId: string, userId: string, redirectUri: string, codeChallenge: string): void {
  const sdb = getSystemDb();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
  sdb.prepare(
    "INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(code, clientId, userId, redirectUri, codeChallenge, expiresAt);
}

export function findOAuthCode(code: string): { code: string; client_id: string; user_id: string; redirect_uri: string; code_challenge: string; expires_at: string; used: number } | null {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT * FROM oauth_codes WHERE code = ?").get(code);
  return (row as any) || null;
}

export function markOAuthCodeUsed(code: string): void {
  const sdb = getSystemDb();
  sdb.prepare("UPDATE oauth_codes SET used = 1 WHERE code = ?").run(code);
}

export function storeOAuthToken(tokenHash: string, clientId: string, userId: string, expiresAt: string, refreshTokenHash: string, refreshExpiresAt: string): void {
  const sdb = getSystemDb();
  sdb.prepare(
    "INSERT INTO oauth_tokens (token_hash, client_id, user_id, expires_at, refresh_token_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(tokenHash, clientId, userId, expiresAt, refreshTokenHash, refreshExpiresAt);
}

export function findOAuthToken(tokenHash: string): { token_hash: string; client_id: string; user_id: string; expires_at: string; revoked: number } | null {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ?").get(tokenHash);
  return (row as any) || null;
}

export function findOAuthTokenByRefresh(refreshHash: string): { token_hash: string; client_id: string; user_id: string; refresh_token_hash: string; refresh_expires_at: string; revoked: number } | null {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT * FROM oauth_tokens WHERE refresh_token_hash = ? AND revoked = 0").get(refreshHash);
  return (row as any) || null;
}

export function revokeOAuthToken(tokenHash: string): void {
  const sdb = getSystemDb();
  sdb.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ? OR refresh_token_hash = ?").run(tokenHash, tokenHash);
}

export function getApiKeyCount(userId: string): number {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?").get(userId) as { count: number };
  return row.count;
}

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export function getDailySearchCount(userId: string): number {
  const sdb = getSystemDb();
  const row = sdb.prepare("SELECT daily_search_count FROM users WHERE id = ?").get(userId) as { daily_search_count: number } | undefined;
  return row?.daily_search_count ?? 0;
}

export function incrementDailySearchCount(userId: string): void {
  const sdb = getSystemDb();
  sdb.prepare("UPDATE users SET daily_search_count = daily_search_count + 1 WHERE id = ?").run(userId);
}

export function resetDailySearchIfNeeded(userId: string): void {
  const sdb = getSystemDb();
  const today = getTodayUTC();
  const row = sdb.prepare("SELECT daily_search_reset FROM users WHERE id = ?").get(userId) as { daily_search_reset: string | null } | undefined;
  if (!row || row.daily_search_reset !== today) {
    sdb.prepare("UPDATE users SET daily_search_count = 0, daily_search_reset = ? WHERE id = ?").run(today, userId);
  }
}

/**
 * Atomic check-and-increment for daily search limit.
 * Resets counter if new day, checks limit, increments if allowed.
 */
export function checkAndIncrementSearch(userId: string, limit: number): { allowed: boolean; current: number; limit: number } {
  resetDailySearchIfNeeded(userId);
  const current = getDailySearchCount(userId);
  if (current >= limit) {
    return { allowed: false, current, limit };
  }
  incrementDailySearchCount(userId);
  return { allowed: true, current: current + 1, limit };
}
