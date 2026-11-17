// Dépôt D1 : événements terminal (télémétrie non sensible).
// Métadonnées = JSON TEXT volontairement pauvre : jamais de contenu du
// formulaire publicitaire, jamais d'ANDROID_ID, jamais de numéro WhatsApp.

export type DeviceEventType =
  | "terminal_created"
  | "terminal_seen"
  | "export_authorized"
  | "export_replayed"
  | "payment_initiated"
  | "payment_confirmed"
  | "payment_rejected"
  | "grant_created";

export async function recordDeviceEvent(
  db: D1Database,
  row: {
    id: string;
    terminalId: string;
    eventType: DeviceEventType;
    occurredAt: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO device_events (id, terminal_id, event_type, occurred_at, metadata)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(
      row.id,
      row.terminalId,
      row.eventType,
      row.occurredAt,
      JSON.stringify(row.metadata),
    )
    .run();
}
