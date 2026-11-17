// =====================================================================
// VITRINE VIDEO LITE — API serveur (Cloudflare Worker).
// Routeur principal : sécurité périphérique (taille, CORS minimal, rate
// limiting, erreurs normalisées) puis dispatch des routes.
//
// Ce backend ne stocke AUCUNE vidéo, AUCUNE information du formulaire
// publicitaire, AUCUN compte utilisateur, AUCUNE promotion, AUCUN
// parrainage. Un téléphone = un terminal pseudonymisé = des crédits.
// =====================================================================

import { SystemClock, toIso } from "./clock/clock";
import { ApiError, jsonError } from "./security/errors";
import { checkRateLimit, RATE_LIMITS } from "./security/ratelimit";
import { computeDeviceHash, normalizeAndroidId } from "./security/hmac";
import { health, ready } from "./routes/health";
import { bootstrap, me } from "./routes/terminals";
import { authorize } from "./routes/exports";
import { plans } from "./routes/plans";
import { initiate, webhook } from "./routes/payments";
import { metrics } from "./routes/admin";
import { settle } from "./routes/simulation";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    const clock = new SystemClock();
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // --- CORS minimal : les clients natifs (Android) ne sont pas soumis
      // au CORS ; aucune origine navigateur n'est autorisée à lire les
      // réponses métier. Les preflights reçoivent une réponse honnête.
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "allow-methods": "GET, POST",
            "allow-headers": "content-type, x-device-id, idempotency-key, authorization",
            "cache-control": "no-store",
          },
        });
      }

      // --- Limite de taille des requêtes (aucun média ne doit jamais
      // transiter : le backend ne reçoit ni vidéo ni photo ni audio).
      const contentLength = Number(request.headers.get("content-length") ?? "0");
      const maxBody = path === "/v1/payments/cinetpay/webhook" ? 64 * 1024 : 8 * 1024;
      if (Number.isFinite(contentLength) && contentLength > maxBody) {
        throw new ApiError(
          "REQUEST_TOO_LARGE",
          `Corps de requête trop volumineux (max ${maxBody} octets) — ce backend n'accepte aucun média.`,
        );
      }

      // --- Rate limiting (fenêtre fixe 60 s, D1 partagé).
      const identity = await requestIdentity(request, env);
      await enforceRateLimit(env, clock, path, request.method, identity);

      // --- Dispatch.
      if (request.method === "GET" && path === "/health") {
        return health(env, clock);
      }
      if (request.method === "GET" && path === "/ready") {
        return await ready(env.DB);
      }
      if (request.method === "GET" && path === "/v1/plans") {
        return plans();
      }
      if (request.method === "POST" && path === "/v1/terminals/bootstrap") {
        return await bootstrap(request, env, clock);
      }
      if (request.method === "GET" && path === "/v1/terminals/me") {
        return await me(request, env, clock);
      }
      if (request.method === "POST" && path === "/v1/exports/authorize") {
        return await authorize(request, env, clock);
      }
      if (request.method === "POST" && path === "/v1/payments/initiate") {
        return await initiate(request, env, clock);
      }
      if (request.method === "POST" && path === "/v1/payments/cinetpay/webhook") {
        return await webhook(request, env, clock);
      }
      if (request.method === "GET" && path === "/v1/admin/metrics") {
        return await metrics(request, env, clock);
      }
      if (request.method === "POST" && path === "/__test__/payments/settle") {
        return await settle(request, env, clock);
      }

      throw new ApiError("NOT_FOUND", "Route inconnue.");
    } catch (err) {
      if (err instanceof ApiError) {
        const headers: Record<string, string> = { "x-request-id": requestId };
        if (err.code === "RATE_LIMITED") headers["retry-after"] = "60";
        const res = jsonError(err, requestId);
        return new Response(res.body, {
          status: res.status,
          headers: { ...Object.fromEntries(res.headers), ...headers },
        });
      }
      // Erreur inattendue : journal EXPURGÉ (aucune donnée de requête,
      // aucun identifiant, aucun secret) + 500 normalisé.
      console.error(
        JSON.stringify({
          level: "error",
          request_id: requestId,
          path,
          method: request.method,
          message: err instanceof Error ? err.message : "unknown",
          utc_now: toIso(clock.now()),
        }),
      );
      const internal = new ApiError("INTERNAL_ERROR", "Erreur interne.");
      const res = jsonError(internal, requestId);
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), "x-request-id": requestId },
      });
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------
// Sécurité périphérique
// ---------------------------------------------------------------------

async function requestIdentity(
  request: Request,
  env: Env,
): Promise<string> {
  // Identité de rate limiting : hash pseudonyme (jamais l'ANDROID_ID brut)
  // ou IP de connexion pour les routes sans terminal.
  const deviceId = request.headers.get("x-device-id");
  if (deviceId !== null && env.DEVICE_ID_HMAC_SECRET) {
    const normalized = normalizeAndroidId(deviceId);
    if (normalized !== null) {
      const { deviceHash } = await computeDeviceHash(
        env.DEVICE_ID_HMAC_SECRET,
        normalized,
      );
      return deviceHash.slice(0, 16);
    }
  }
  return (request.headers.get("cf-connecting-ip") ?? "unknown").slice(0, 45);
}

async function enforceRateLimit(
  env: Env,
  clock: SystemClock,
  path: string,
  method: string,
  identity: string,
): Promise<void> {
  let rule: { routeClass: string; limit: number };
  if (path === "/v1/terminals/bootstrap") {
    rule = { routeClass: "bootstrap", limit: RATE_LIMITS.bootstrap };
  } else if (path === "/v1/terminals/me") {
    rule = { routeClass: "me", limit: RATE_LIMITS.terminalRead };
  } else if (path === "/v1/exports/authorize") {
    rule = { routeClass: "authorize", limit: RATE_LIMITS.exportAuthorize };
  } else if (path === "/v1/payments/initiate") {
    rule = { routeClass: "initiate", limit: RATE_LIMITS.paymentInitiate };
  } else if (path === "/v1/payments/cinetpay/webhook") {
    rule = { routeClass: "webhook", limit: RATE_LIMITS.webhook };
  } else if (path === "/v1/admin/metrics") {
    rule = { routeClass: "admin", limit: RATE_LIMITS.admin };
  } else if (path === "/__test__/payments/settle") {
    rule = { routeClass: "sim", limit: RATE_LIMITS.simulation };
  } else if (
    (method === "GET" && path === "/health") ||
    (method === "GET" && path === "/ready") ||
    (method === "GET" && path === "/v1/plans")
  ) {
    rule = { routeClass: "public", limit: RATE_LIMITS.publicRead };
  } else {
    return; // route inconnue : le 404 suivant suffit
  }

  const result = await checkRateLimit(env.DB, clock, {
    routeClass: rule.routeClass,
    identity,
    limit: rule.limit,
  });
  if (!result.allowed) {
    throw new ApiError(
      "RATE_LIMITED",
      `Trop de requêtes (${result.limit}/min autorisées).`,
      { limit: result.limit, window_s: 60 },
    );
  }
}
