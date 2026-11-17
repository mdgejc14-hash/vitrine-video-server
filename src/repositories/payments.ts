// Dépôt D1 : paiements + événements webhook fournisseur.

export interface PaymentRow {
  id: string;
  terminal_id: string;
  provider: string;
  product_code: string;
  merchant_transaction_id: string;
  provider_transaction_id: string | null;
  amount: number;
  currency: string;
  payment_status: "PENDING" | "PAID" | "FAILED" | "CANCELLED";
  provider_reference: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  expires_at: string | null;
}

export async function insertPayment(
  db: D1Database,
  row: PaymentRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO payments
         (id, terminal_id, provider, product_code, merchant_transaction_id,
          provider_transaction_id, amount, currency, payment_status,
          provider_reference, created_at, updated_at, confirmed_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(
      row.id, row.terminal_id, row.provider, row.product_code, row.merchant_transaction_id,
      row.provider_transaction_id, row.amount, row.currency, row.payment_status,
      row.provider_reference, row.created_at, row.updated_at, row.confirmed_at, row.expires_at,
    )
    .run();
}

export async function findByMerchantTransactionId(
  db: D1Database,
  mti: string,
): Promise<PaymentRow | null> {
  return db
    .prepare("SELECT * FROM payments WHERE merchant_transaction_id = ?1")
    .bind(mti)
    .first<PaymentRow>();
}

export async function updatePaymentStatus(
  db: D1Database,
  id: string,
  status: PaymentRow["payment_status"],
  nowIso: string,
  extra?: { providerTransactionId?: string | null; providerReference?: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE payments
         SET payment_status = ?2,
             provider_transaction_id = COALESCE(?3, provider_transaction_id),
             provider_reference = COALESCE(?4, provider_reference),
             confirmed_at = CASE WHEN ?2 = 'PAID' THEN ?5 ELSE confirmed_at END,
             updated_at = ?5
       WHERE id = ?1`,
    )
    .bind(
      id, status, extra?.providerTransactionId ?? null, extra?.providerReference ?? null, nowIso,
    )
    .run();
}

// --- Événements webhook (journal + idempotence fournisseur) ---

export interface WebhookEventRow {
  id: string;
  provider: string;
  event_reference: string | null;
  merchant_transaction_id: string | null;
  status: "RECEIVED" | "PROCESSED" | "REJECTED" | "DUPLICATE";
  received_at: string;
  processed_at: string | null;
  error_code: string | null;
}

/**
 * Journalise la réception. Retourne false si un événement équivalent
 * (même provider + event_reference non null) existe déjà = REJEU.
 */
export async function recordWebhookReceipt(
  db: D1Database,
  row: WebhookEventRow,
): Promise<boolean> {
  try {
    await db
      .prepare(
        `INSERT INTO payment_webhook_events
           (id, provider, event_reference, merchant_transaction_id, status, received_at)
         VALUES (?1, ?2, ?3, ?4, 'RECEIVED', ?5)`,
      )
      .bind(row.id, row.provider, row.event_reference, row.merchant_transaction_id, row.received_at)
      .run();
    return true;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed")
    ) {
      return false; // rejeu du même event_reference
    }
    throw err;
  }
}

export async function finishWebhookEvent(
  db: D1Database,
  id: string,
  status: WebhookEventRow["status"],
  nowIso: string,
  errorCode: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE payment_webhook_events
         SET status = ?2, processed_at = ?3, error_code = ?4
       WHERE id = ?1`,
    )
    .bind(id, status, nowIso, errorCode)
    .run();
}
