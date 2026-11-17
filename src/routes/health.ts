// GET /health — état du Worker (aucun secret).
// GET /ready  — vérifie la dépendance D1 indispensable.

import { toIso, Clock } from "../clock/clock";

export function health(env: Env, clock: Clock): Response {
  return Response.json({
    status: "ok",
    service: "vitrine-video-lite-api",
    version: env.API_VERSION,
    environment: env.ENVIRONMENT,
    payment_mode: env.PAYMENT_MODE,
    utc_now: toIso(clock.now()),
  });
}

export async function ready(db: D1Database): Promise<Response> {
  try {
    const res = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master
          WHERE type = 'table' AND name IN
          ('terminals','credit_grants','payments','export_authorizations',
           'payment_webhook_events','device_events','rate_limit_counters')`,
      )
      .first<{ n: number }>();
    const tables = res?.n ?? 0;
    if (tables !== 7) {
      return Response.json(
        { ready: false, database: "schema_incomplete", tables_found: tables },
        { status: 503 },
      );
    }
    return Response.json({ ready: true, database: "connected", tables: tables });
  } catch {
    return Response.json({ ready: false, database: "unreachable" }, { status: 503 });
  }
}
