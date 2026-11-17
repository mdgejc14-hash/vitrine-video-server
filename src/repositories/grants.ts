// Dépôt D1 : lots de crédits (crédits gratuits + pass).

export interface CreditGrantRow {
  id: string;
  terminal_id: string;
  grant_type: "free_install" | "pass";
  product_code: string;
  credits_total: number;
  credits_remaining: number;
  starts_at: string;
  expires_at: string | null;
  status: string;
  payment_id: string | null;
  created_at: string;
}

export async function listByTerminal(
  db: D1Database,
  terminalId: string,
): Promise<CreditGrantRow[]> {
  const res = await db
    .prepare(
      `SELECT * FROM credit_grants
        WHERE terminal_id = ?1
        ORDER BY (expires_at IS NULL) ASC, expires_at ASC, created_at ASC`,
    )
    .bind(terminalId)
    .all<CreditGrantRow>();
  return res.results ?? [];
}

export async function insertGrant(
  db: D1Database,
  row: CreditGrantRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credit_grants
         (id, terminal_id, grant_type, product_code, credits_total,
          credits_remaining, starts_at, expires_at, status, payment_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      row.id, row.terminal_id, row.grant_type, row.product_code, row.credits_total,
      row.credits_remaining, row.starts_at, row.expires_at, row.status, row.payment_id,
      row.created_at,
    )
    .run();
}

// ---------------------------------------------------------------------------
// DÉBIT ATOMIQUE D'UN CRÉDIT — « réservation ».
// Une seule instruction UPDATE (sérialisée par SQLite) :
//   - sélection du lot éligible : payant valide qui expire le PLUS TÔT
//     d'abord (les crédits gratuits sont préservés tant qu'un lot payant
//     valide a des crédits — règle §4.4 de la mission) ;
//   - débit conditionnel (credits_remaining > 0).
// Retour : id du lot débité, ou null si aucun crédit utilisable.
// NOTE D1 : les CTE contenant UPDATE (« data-modifying CTE ») sont refusés
// par le parseur D1/workd (erreur « near UPDATE ») — d'où ce pattern en
// réservation + compensation (voir ExportService.authorize).
// ---------------------------------------------------------------------------

export async function debitOneCredit(
  db: D1Database,
  params: { terminalId: string; nowIso: string },
): Promise<{ grantId: string } | null> {
  const res = await db
    .prepare(
      `UPDATE credit_grants
          SET credits_remaining = credits_remaining - 1
        WHERE id = (
          SELECT id FROM credit_grants
           WHERE terminal_id = ?1
             AND status = 'active'
             AND credits_remaining > 0
             AND (expires_at IS NULL OR expires_at > ?2)
           ORDER BY (expires_at IS NULL) ASC, expires_at ASC
           LIMIT 1
        )
          AND credits_remaining > 0
      RETURNING id`,
    )
    .bind(params.terminalId, params.nowIso)
    .first<{ id: string }>();
  return res === null ? null : { grantId: res.id };
}

/** Compensation : re-crédite un lot débité à tort (course同一 idempotence). */
export async function creditBack(
  db: D1Database,
  grantId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE credit_grants
          SET credits_remaining = MIN(credits_remaining + 1, credits_total)
        WHERE id = ?1`,
    )
    .bind(grantId)
    .run();
}

/**
 * Insertion de l'autorisation d'export (UNIQUE terminal_id+idempotency_key).
 * Retourne false si la clé existe déjà (replay/concurrent).
 */
export async function insertAuthorization(
  db: D1Database,
  row: {
    id: string;
    terminalId: string;
    grantId: string;
    idempotencyKey: string;
    nowIso: string;
  },
): Promise<boolean> {
  try {
    await db
      .prepare(
        `INSERT INTO export_authorizations
           (id, terminal_id, grant_id, idempotency_key, status, authorized_at, created_at)
         VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`,
      )
      .bind(row.id, row.terminalId, row.grantId, row.idempotencyKey, row.nowIso)
      .run();
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return false;
    }
    throw err;
  }
}
