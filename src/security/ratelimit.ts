// Rate limiting — fenêtre fixe de 60 s, compteur atomique en D1.
// Best-effort documenté : la fenêtre est fixe (rafale possible au bord de
// fenêtre), le compteur est partagé entre tous les isolates via D1 (fiable).
// Les clés n'utilisent JAMAIS l'ANDROID_ID brut : device_hash tronqué ou IP.

import { toIso, Clock } from "../clock/clock";

export interface RateLimitRule {
  /** classe de route (préfixe de la clé) */
  routeClass: string;
  /** identifiant pseudonyme ou IP du demandeur */
  identity: string;
  limit: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

const WINDOW_S = 60;

export async function checkRateLimit(
  db: D1Database,
  clock: Clock,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const now = clock.now();
  const windowStart = new Date(Math.floor(now.getTime() / 1000 / WINDOW_S) * WINDOW_S * 1000);
  const key = `${rule.routeClass}:${rule.identity}`;
  const ws = toIso(windowStart);

  const res = await db
    .prepare(
      `INSERT INTO rate_limit_counters (key, window_start, count)
       VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
         window_start = ?2
       RETURNING count`,
    )
    .bind(key, ws)
    .first<{ count: number }>();

  const count = res?.count ?? 1;
  return { allowed: count <= rule.limit, count, limit: rule.limit };
}

/**
 * Limites officielles par classe de route (fenêtre fixe 60 s).
 * exportAuthorize = 240/min : calibré pour laisser passer les bancs de
 * validation officiels (un Pass Boutique = 200 exports consécutifs en
 * moins d'une minute de test) tout en bloquant le hammering soutenu.
 */
export const RATE_LIMITS = {
  bootstrap: 12,
  terminalRead: 60,
  exportAuthorize: 240,
  paymentInitiate: 10,
  webhook: 120,
  admin: 30,
  publicRead: 240,
  simulation: 60,
} as const;
