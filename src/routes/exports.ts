// POST /v1/exports/authorize
//
// Règle métier essentielle : UNE publicité finalisée = UN crédit.
// Enregistrer dans la galerie puis partager sur WhatsApp = la MÊME
// autorisation : l'application réutilise la même Idempotency-Key.
// Le serveur ne reçoit jamais le fichier vidéo.

import { toIso, Clock } from "../clock/clock";
import { ApiError } from "../security/errors";
import { ExportService } from "../services/exportService";
import { identifyTerminal } from "./terminals";

export async function authorize(
  request: Request,
  env: Env,
  clock: Clock,
): Promise<Response> {
  const terminal = await identifyTerminal(request, env, clock);

  const key = request.headers.get("idempotency-key");
  if (key === null || key.trim().length === 0) {
    throw new ApiError(
      "MISSING_IDEMPOTENCY_KEY",
      "En-tête Idempotency-Key requis (stable pour une même publicité).",
    );
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key invalide (8 à 128 caractères alphanumériques . _ : -).",
    );
  }

  const svc = new ExportService(env.DB, clock);
  const result = await svc.authorize(terminal.id, key);

  return Response.json(
    {
      authorization: result.authorization,
      replay: result.replay,
      rule: "one_ad_one_credit",
      credits: {
        total_usable: result.credits_after.total_usable,
        free_remaining: result.credits_after.free_remaining,
        paid_remaining: result.credits_after.paid_remaining,
      },
      authorized_at_utc: toIso(clock.now()),
    },
    { status: result.replay ? 200 : 201 },
  );
}
