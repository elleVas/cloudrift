// SPDX-License-Identifier: Apache-2.0
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from 'shared-kernel';

const logger = createLogger('cloudrift:trend-store');

export type TrendDomain = 'cloud-cost' | 'dead-resources' | 'resource-security';

export interface TrendSnapshot {
  readonly domain: TrendDomain;
  /** ISO timestamp, same value as the report's own `meta.generatedAt`. */
  readonly generatedAt: string;
  /** The exact `--format json` payload for this run — the DTO is the only correct serialization of a scan summary (see `toWasteReportDto` et al.), so snapshots reuse it rather than re-deriving one. */
  readonly payload: string;
}

export interface TrendSnapshotRecord extends TrendSnapshot {
  readonly id: number;
}

export function defaultTrendStoreDir(): string {
  return join(homedir(), '.cloudrift', 'trends');
}

function dbPathFor(accountId: string, dir: string): string {
  return join(dir, `${accountId}.db`);
}

/**
 * node:sqlite requires Node >=22.5; `apps/cli`'s published `engines.node` is
 * `>=20`. A static `import` of a nonexistent core module throws at load
 * time, which would crash the whole CLI (every command, not just the trend
 * store) for anyone still on Node 20/21 — so it's loaded lazily, only when a
 * snapshot is actually written or read, and only ever inside a try/catch.
 */
async function loadDatabaseSync(): Promise<typeof import('node:sqlite').DatabaseSync> {
  const sqlite = await import('node:sqlite');
  return sqlite.DatabaseSync;
}

function ensureSchema(db: InstanceType<typeof import('node:sqlite').DatabaseSync>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scan_snapshots_domain_generated_at
      ON scan_snapshots (domain, generated_at);
  `);
}

/**
 * Persists one full scan snapshot to the caller's per-AWS-account SQLite
 * file (`~/.cloudrift/trends/<account-id>.db` by default). Best-effort: any
 * failure (old Node without `node:sqlite`, permission error, disk full,
 * corrupt file) is logged at debug level and swallowed — the trend store is
 * a secondary feature and must never fail the scan command itself, same
 * contract as `CachedCostExplorerAdapter.writeCache`.
 */
export async function persistTrendSnapshot(
  accountId: string,
  snapshot: TrendSnapshot,
  options: { dir?: string } = {},
): Promise<void> {
  const dir = options.dir ?? defaultTrendStoreDir();
  try {
    const DatabaseSync = await loadDatabaseSync();
    await mkdir(dir, { recursive: true });
    const db = new DatabaseSync(dbPathFor(accountId, dir));
    try {
      ensureSchema(db);
      db.prepare('INSERT INTO scan_snapshots (domain, generated_at, payload) VALUES (?, ?, ?)').run(
        snapshot.domain,
        snapshot.generatedAt,
        snapshot.payload,
      );
    } finally {
      db.close();
    }
  } catch (error) {
    logger.debug('trend snapshot write failed', {
      accountId,
      domain: snapshot.domain,
      error: (error as Error).message,
    });
  }
}

/**
 * Reads back snapshots for one account, most-recent-first, optionally
 * filtered by domain. A missing DB file (nothing scanned yet, or the
 * account has never persisted a snapshot) returns an empty array rather
 * than an error.
 */
export async function readTrendSnapshots(
  accountId: string,
  options: { dir?: string; domain?: TrendDomain; limit?: number } = {},
): Promise<TrendSnapshotRecord[]> {
  const dir = options.dir ?? defaultTrendStoreDir();
  const path = dbPathFor(accountId, dir);
  if (!existsSync(path)) return [];

  const DatabaseSync = await loadDatabaseSync();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const where = options.domain ? 'WHERE domain = ?' : '';
    const params = options.domain ? [options.domain] : [];
    const rows = db
      .prepare(`SELECT id, domain, generated_at, payload FROM scan_snapshots ${where} ORDER BY generated_at DESC LIMIT ?`)
      .all(...params, options.limit ?? 100) as Array<{
      id: number;
      domain: string;
      generated_at: string;
      payload: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      domain: row.domain as TrendDomain,
      generatedAt: row.generated_at,
      payload: row.payload,
    }));
  } finally {
    db.close();
  }
}
