// Routes paiements.
//
// POST /v1/payments/initiate — demande de paiement d'un pass (le serveur
//   fixe seul le montant, les crédits et la durée).
// POST /v1/payments/cinetpay/webhook — notification IPN CinetPay. La
//   notification N'EST PAS une preuve : le serveur vérifie TOUJOURS la
//   transaction via /v2/payment/check officiel avant tout crédit.

import { toIso, Clock } from "../clock/clock";
import { ApiError } from "../security/errors";
import { PaymentService, PaymentServiceConfig } from "../services/paymentService";
import { identifyTerminal } from "./terminals";

const MAX_JSON_BODY = 8 * 1024;
const MAX_WEBHOOK_BODY = 64 * 1024;

function serviceConfig(env: Env): PaymentServiceConfig {
  return {
    paymentMode: env.PAYMENT_MODE,
    cinetpayEnabled: env.CINETPAY_ENABLED,
    cinetpayApiKey: env.CINETPAY_API_KEY,
    cinetpaySiteId: env.CINETPAY_SITE_ID,
    cinetpayApiBase: env.CINETPAY_API_BASE,
    notifyUrl: env.CINETPAY_NOTIFY_URL,
    returnUrl: env.CINETPAY_RETURN_URL,
  };
}

export async function initiate(
  request: Request,
  env: Env,
  clock: Clock,
): Promise<Response> {
  const terminal = await identifyTerminal(request, env, clock);

  const raw = await request.text();
  if (raw.length === 0) {
    throw new ApiError("INVALID_REQUEST", "Corps JSON requis : { product_code }.");
  }
  let productCode: unknown;
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    productCode = body.product_code;
  } catch {
    throw new ApiError("INVALID_REQUEST", "Corps JSON invalide.");
  }
  if (typeof productCode !== "string") {
    throw new ApiError("INVALID_PRODUCT", "product_code (chaîne) requis.");
  }

  const svc = new PaymentService(env.DB, clock, serviceConfig(env));
  const result = await svc.initiate(terminal.id, productCode);

  return Response.json(result, { status: 200 });
}

export interface WebhookForm {
  cpm_trans_id: string | null;
  cpm_payid: string | null;
  cpm_site_id: string | null;
  cpm_amount: string | null;
  cpm_currency: string | null;
  signature: string | null;
}

export function parseWebhookForm(body: string): WebhookForm {
  const params = new URLSearchParams(body);
  const get = (k: string): string | null => {
    const v = params.get(k);
    return v === null || v.length === 0 ? null : v;
  };
  return {
    cpm_trans_id: get("cpm_trans_id"),
    cpm_payid: get("cpm_payid"),
    cpm_site_id: get("cpm_site_id"),
    cpm_amount: get("cpm_amount"),
    cpm_currency: get("cpm_currency"),
    signature: get("signature"),
  };
}

export async function webhook(
  request: Request,
  env: Env,
  clock: Clock,
): Promise<Response> {
  const raw = await request.text();

  // Format officiel de la notification : POST application/x-www-form-urlencoded.
  const form = parseWebhookForm(raw);
  if (form.cpm_trans_id === null) {
    // Accès direct ou notification vide : rejet explicite, aucun crédit.
    throw new ApiError("INVALID_REQUEST", "cpm_trans_id manquant.");
  }

  const svc = new PaymentService(env.DB, clock, serviceConfig(env));
  const outcome = await svc.settleFromProvider({
    source: "webhook",
    merchantTransactionId: form.cpm_trans_id,
    eventReference: form.cpm_payid ?? form.signature,
  });

  // Toujours 200 vers le fournisseur une fois la notification traitée
  // (journalisée, créditée ou rejetée) pour arrêter les re-notifications.
  return Response.json({
    received: true,
    credited: outcome.credited,
    already: outcome.already,
    duplicate: outcome.duplicate,
    reason: outcome.reason ?? null,
    processed_at: toIso(clock.now()),
  });
}

export { MAX_JSON_BODY, MAX_WEBHOOK_BODY };
