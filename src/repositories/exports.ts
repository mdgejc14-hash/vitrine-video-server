// Dépôt D1 : autorisations d'export.

export interface ExportAuthorizationRow {
  id: string;
  terminal_id: string;
  grant_id: string;
  idempotency_key: string;
  status: string;
  authorized_at: string;
  created_at: string;
}

export async function findByIdempotencyKey(
  db: D1Database,
  terminalId: string,
  idempotencyKey: string,
): Promise<ExportAuthorizationRow | null> {
  return db
    .prepare(
      `SELECT * FROM export_authorizations
        WHERE terminal_id = ?1 AND idempotency_key = ?2`,
    )
    .bind(terminalId, idempotencyKey)
    .first<ExportAuthorizationRow>();
}
