// Routes terminaux.
//
// POST /v1/terminals/bootstrap (écran 03) — initialise ou retrouve un terminal
//   (3 crédits gratuits une seule fois, jamais réattribués).
// GET /v1/terminals/me — l'état complet pour l'écran 12 « Tableau de bord ».

import { toIso, Clock } from "../clock/clock";
import { ApiError } from "../security/errors";
import { normalizeAndroidId } from "../security/hmac";
import { PLANS, publicPlan } from "../catalog/plans";
import { TerminalService } from "../services/terminalService";
import { CreditService } from "../services/creditService";
import { TerminalRow } from "../repositories/terminals";

const MAX_BODY = 8 * 1024; // 8 Ko — bootstrap n'a rien de plus à transporter

export async function bootstrap(
  request: Request,
  env: Env,
  clock: Clock,
): Promise<Response> {
  const deviceId = requireDeviceIdHeader(request);
  const androidId = normalizeAndroidId(deviceId);
  if (androidId === null) {
    throw new ApiError(
      "INVALID_DEVICE_ID",
      "Identifiant de terminal invalide (hexadécimal 8 à 64 attendu).",
    );
  }

  let appVersion: string | undefined;
  let platform: string | undefined;
  const raw = await request.text();
  if (raw.length > 0) {
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      appVersion = optString(body.app_version, 32);
      platform = optString(body.platform, 32);
    } catch {
      throw new ApiError("INVALID_REQUEST", "Corps JSON invalide.");
    }
  }

  const svc = new TerminalService(env.DB, clock, requireHmacSecret(env));
  const { terminal, created } = await svc.bootstrap({
    androidId,
    appVersion,
    platform,
  });
  const credits = await new CreditService(env.DB, clock).getBalance(terminal.id);

  return Response.json(
    {
      terminal: terminalView(terminal, clock),
      created,
      credits: {
        total_usable: credits.total_usable,
        free_remaining: credits.free_remaining,
        paid_remaining: credits.paid_remaining,
      },
      free_credits_policy: {
        credits: 3,
        expires: false,
        reattributed_on_reinstall: false,
      },
      plans: PLANS.map(publicPlan),
    },
    { status: created ? 201 : 200 },
  );
}

export async function me(
  request: Request,
  env: Env,
  clock: Clock,
): Promise<Response> {
  const terminal = await identifyTerminal(request, env, clock);
  const credits = await new CreditService(env.DB, clock).getBalance(terminal.id);
  return Response.json({
    terminal: terminalView(terminal, clock),
    credits: {
      total_usable: credits.total_usable,
      free_remaining: credits.free_remaining,
      paid_remaining: credits.paid_remaining,
      can_export: credits.can_export,
    },
    grants: credits.grants,
    active_passes: credits.active_passes.map((g) => ({
      id: g.id,
      product_code: g.product_code,
      credits_remaining: g.credits_remaining,
      expires_at: g.expires_at,
      status: g.status,
    })),
    plans: PLANS.map(publicPlan),
  });
}

export function terminalView(t: TerminalRow, clock: Clock) {
  return {
    id: t.id,
    // Identifiant pseudonyme seul — JAMAIS de hash complet ni d'ANDROID_ID.
    pseudonym: `term-${t.id.slice(0, 8)}`,
    first_seen_at: t.first_seen_at,
    last_seen_at: t.last_seen_at,
    status: t.status,
    server_utc_now: toIso(clock.now()),
  };
}

// --- helpers partagés ------------------------------------------------

export function requireDeviceIdHeader(request: Request): string {
  const v = request.headers.get("x-device-id");
  if (v === null || v.trim().length === 0) {
    throw new ApiError(
      "MISSING_DEVICE_ID",
      "En-tête X-Device-id requis (ANDROID_ID du terminal).",
    );
  }
  return v;
}

export function requireHmacSecret(env: Env): string {
  if (!env.DEVICE_ID_HMAC_SECRET) {
    throw new ApiError(
      "INTERNAL_ERROR",
      "Configuration serveur incomplète (DEVICE_ID_HMAC_SECRET absent).",
    );
  }
  return env.DEVICE_ID_HMAC_SECRET;
}

export async function identifyTerminal(
  request: Request,
  env: Env,
  clock: Clock,
): Promise<TerminalRow> {
  const raw = requireDeviceIdHeader(request);
  const androidId = normalizeAndroidId(raw);
  if (androidId === null) {
    throw new ApiError("INVALID_DEVICE_ID", "Identifiant de terminal invalide.");
  }
  const svc = new TerminalService(env.DB, clock, requireHmacSecret(env));
  return svc.identify(androidId);
}

export function optString(v: unknown, max: number): string | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  return v.slice(0, max);
}

export { MAX_BODY };
