// GET /v1/admin/metrics — statistiques agrégées, protégées par token
// administrateur (ADMIN_METRICS_TOKEN, secret Cloudflare). Comparaison en
// temps constant. Aucune donnée individuelle n'est retournée.

import { Clock } from "../clock/clock";
import { ApiError } from "../security/errors";
import { MetricsService } from "../services/metricsService";

export async function metrics(
  request: Request,
  env: Env,
  clock: Clock,
): Promise<Response> {
  if (!env.ADMIN_METRICS_TOKEN) {
    throw new ApiError(
      "INTERNAL_ERROR",
      "Configuration serveur incomplète (ADMIN_METRICS_TOKEN absent).",
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.ADMIN_METRICS_TOKEN}`;
  if (!constantTimeEqual(auth, expected)) {
    throw new ApiError("UNAUTHORIZED", "Token administrateur invalide.");
  }
  const svc = new MetricsService(env.DB, clock);
  return Response.json(await svc.compute());
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
