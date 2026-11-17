// POST /__test__/payments/settle — simulateur de règlement STAGING UNIQUEMENT.
//
// - Accessible uniquement quand ENVIRONMENT === "staging" (404 sinon : la
//   production n'expose AUCUN endpoint de règlement de test).
// - Exige le secret de simulation (SIMULATION_SECRET, Bearer).
// - Accepte une transaction PENDING existante et utilise le produit et le
//   montant ENREGISTRÉS à l'initiation — le client ne choisit ni crédits
//   ni montant.
// - Appelle le MÊME service interne que le webhook CinetPay réel.
// - Refuse toute transaction incohérente et respecte l'idempotence.

import { toIso, Clock } from "../clock/clock";
import { ApiError } from "../security/errors";
import { PaymentService, PaymentServiceConfig } from "../services/paymentService";

export async function settle(
  request: Request,
  env: Env,
  clock: Clock,
): Promise<Response> {
  if (env.ENVIRONMENT !== "staging") {
    // En production, cet endpoint n'existe pas (404, aucune piste).
    throw new ApiError("SIMULATION_DISABLED", "Ressource inexistante.");
  }
  if (!env.SIMULATION_SECRET) {
    throw new ApiError(
      "INTERNAL_ERROR",
      "Configuration serveur incomplète (SIMULATION_SECRET absent).",
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.SIMULATION_SECRET}`;
  if (auth.length !== expected.length) {
    throw new ApiError("UNAUTHORIZED", "Secret de simulation invalide.");
  }
  let diff = 0;
  for (let i = 0; i < auth.length; i++) diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) {
    throw new ApiError("UNAUTHORIZED", "Secret de simulation invalide.");
  }

  const raw = await request.text();
  if (raw.length === 0) {
    throw new ApiError(
      "INVALID_REQUEST",
      "Corps JSON requis : { merchant_transaction_id, outcome }. (cf. BACKEND_CONTRACT.md)",
    );
  }
  let mti: unknown;
  let outcome: unknown;
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    mti = body.merchant_transaction_id;
    outcome = body.outcome;
  } catch {
    throw new ApiError("INVALID_REQUEST", "Corps JSON invalide.");
  }
  if (typeof mti !== "string" || mti.length === 0 || mti.length > 64) {
    throw new ApiError("INVALID_REQUEST", "merchant_transaction_id invalide.");
  }
  if (outcome !== undefined && outcome !== "success" && outcome !== "failure") {
    throw new ApiError("INVALID_REQUEST", "outcome ∈ { success, failure } ou absent.");
  }

  const cfg: PaymentServiceConfig = {
    paymentMode: env.PAYMENT_MODE,
    cinetpayEnabled: env.CINETPAY_ENABLED,
    cinetpayApiKey: env.CINETPAY_API_KEY,
    cinetpaySiteId: env.CINETPAY_SITE_ID,
  };
  const svc = new PaymentService(env.DB, clock, cfg);
  const result = await svc.settleFromProvider({
    source: "simulation",
    merchantTransactionId: mti,
    eventReference: `SIM-${mti}-${outcome ?? "success"}`,
    simulatedOutcome: outcome === "failure" ? "failure" : "success",
  });

  return Response.json({
    settled: true,
    credited: result.credited,
    already: result.already,
    duplicate: result.duplicate,
    reason: result.reason ?? null,
    grant: result.grant ?? null,
    simulated: true, // jamais présenté comme un paiement réel
    processed_at: toIso(clock.now()),
  });
}
