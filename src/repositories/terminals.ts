// Dépôt D1 : terminaux.

export interface TerminalRow {
  id: string;
  device_hash: string;
  hash_key_version: number;
  first_seen_at: string;
  last_seen_at: string;
  app_version: string | null;
  platform: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function findByDeviceHash(
  db: D1Database,
  deviceHash: string,
): Promise<TerminalRow | null> {
  return db
    .prepare("SELECT * FROM terminals WHERE device_hash = ?1")
    .bind(deviceHash)
    .first<TerminalRow>();
}

export async function findById(
  db: D1Database,
  id: string,
): Promise<TerminalRow | null> {
  return db.prepare("SELECT * FROM terminals WHERE id = ?1").bind(id).first<TerminalRow>();
}

export async function insertTerminal(
  db: D1Database,
  row: TerminalRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO terminals
         (id, device_hash, hash_key_version, first_seen_at, last_seen_at,
          app_version, platform, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      row.id, row.device_hash, row.hash_key_version, row.first_seen_at, row.last_seen_at,
      row.app_version, row.platform, row.status, row.created_at, row.updated_at,
    )
    .run();
}

export async function touchTerminal(
  db: D1Database,
  id: string,
  lastSeenAt: string,
  appVersion: string | null,
  platform: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE terminals
         SET last_seen_at = ?2,
             app_version = COALESCE(?3, app_version),
             platform = COALESCE(?4, platform),
             updated_at = ?2
       WHERE id = ?1`,
    )
    .bind(id, lastSeenAt, appVersion, platform)
    .run();
}

/** Violation d'unicité SQLite (device_hash dupliqué = bootstrap concurrent). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes("UNIQUE constraint failed")
  );
}
