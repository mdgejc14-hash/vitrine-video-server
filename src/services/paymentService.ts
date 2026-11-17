// Service métier : paiements.
//
// - Aucun crédit n'est accordé à l'INITIATION (uniquement après
//   confirmation authentique).
// - Le règlement (settleFromProvider) est le SERVICE PARTAGÉ entre le
//   webhook CinetPay réel et la simulation de staging : mêmes règles,
//   mêmes contrôles, mêmes écritures atomiques.
// - Idempotence : une notification répétée ne double JAMAIS les crédits
//   (statut PAID + journal webhook + contraintes UNIQUE).
// - Le client ne choisit NI le montant, NI les crédits : tout vient du
//   catalogue serveur et de l'enregistrement d'initiation.

import { toIso, Clock } from "../clock/clock";
import { ApiError } from "../security/errors";
import { findPlan, isPaidPass, Plan } from "../catalog/plans";
import {
  PaymentRow,
  insertPayment,
  findByMerchantTransactionId,
  updatePaymentStatus,
  recordWebhookReceipt,
  finishWebhookEvent,
} from "../repositories/payments";
import { recordDeviceEvent } from "../repositories/events";
import { CinetPayClient, CheckResult } from "../payments/cinetpay";
import { verifyCinetPayPayment } from "../payments/verification";

export interface PaymentServiceConfig {
  paymentMode: string; // simulation | disabled | real
  cinetpayEnabled: string; // "true" uniquement avec clés réelles
  cinetpayApiKey?: string;
  cinetpaySiteId?: string;
  cinetpayApiBase?: string;
  /** URL publique du webhook (fournie au fournisseur à l'initiation). */
  notifyUrl?: string;
  returnUrl?: string;
}

export interface InitiateResult {
  payment: {
    id: string;
    merchant_transaction_id: string;
    product_code: string;
    amount: number;
    currency: "XOF";
    payment_status: string;
    expires_at: string | null;
    created_at: string;
  };
  payment_url?: string;
  simulation: boolean;
}

export interface SettleOutcome {
  /** true si un lot de crédits a été créé par CET appel */
  credited: boolean;
  /** true si le paiement était déjà confirmé (idempotence) */
  already: boolean;
  /** true si l'événement était un rejeu connu */
  duplicate: boolean;
  reason?: string;
  grant?: { credits: number; expires_at: string | null };
}

export class PaymentService {
  constructor(
    private db: D1Database,
    private clock: Clock,
    private cfg: PaymentServiceConfig,
  ) {}

  // -----------------------------------------------------------------
  // INITIATION
  // -----------------------------------------------------------------
  async initiate(terminalId: string, productCode: string): Promise<InitiateResult> {
    if (!isPaidPass(productCode)) {
      throw new ApiError(
        "INVALID_PRODUCT",
        "Produit inconnu ou non payant. Formules : PASS_EXPRESS, PASS_PRO, PASS_BOUTIQUE.",
      );
    }
    const plan = findPlan(productCode) as Plan;
    const realMode =
      this.cfg.paymentMode === "real" && this.cfg.cinetpayEnabled === "true";
    const simulationMode = this.cfg.paymentMode === "simulation";

    if (!realMode && !simulationMode) {
      // Production actuelle : paiements réels désactivés, provider absent.
      throw new ApiError(
        "PAYMENT_PROVIDER_NOT_CONFIGURED",
        "CinetPay n'est pas configuré — paiements réels désactivés.",
      );
    }

    const now = new Date(this.clock.now().getTime());
    const nowIso = toIso(now);
    const mti = generateMerchantTransactionId(now);
    const paymentId = crypto.randomUUID();
    // Validité de la fenêtre de paiement : 24 h pour régler l'initiation.
    const expiresAt = toIso(new Date(now.getTime() + 86_400_000));

    await insertPayment(this.db, {
      id: paymentId,
      terminal_id: terminalId,
      provider: "cinetpay",
      product_code: productCode,
      merchant_transaction_id: mti,
      provider_transaction_id: null,
      amount: plan.price_xof,
      currency: "XOF",
      payment_status: "PENDING",
      provider_reference: null,
      created_at: nowIso,
      updated_at: nowIso,
      confirmed_at: null,
      expires_at: expiresAt,
    });
    await recordDeviceEvent(this.db, {
      id: crypto.randomUUID(),
      terminalId,
      eventType: "payment_initiated",
      occurredAt: nowIso,
      metadata: { product_code: productCode, amount: plan.price_xof },
    });

    if (!realMode) {
      // Simulation staging : transaction PENDING prête à être réglée par
      // POST /__test__/payments/settle (secret de simulation requis).
      return {
        payment: paymentView(
          await findByMerchantTransactionId(this.db, mti),
        ),
        simulation: true,
      };
    }

    // Mode réel : appel CinetPay avec les valeurs SERVEUR uniquement.
    const client = new CinetPayClient(
      this.cfg.cinetpayApiKey!,
      this.cfg.cinetpaySiteId!,
      this.cfg.cinetpayApiBase,
    );
    const init = await client.initPayment({
      transactionId: mti,
      amount: plan.price_xof,
      currency: "XOF",
      description: `Vitrine Video — ${plan.label} (${plan.credits} crédits)`,
      notifyUrl: this.cfg.notifyUrl ?? "",
      returnUrl: this.cfg.returnUrl ?? "",
      channels: "MOBILE_MONEY",
      lang: "fr",
      metadata: terminalId,
    });
    await this.db
      .prepare("UPDATE payments SET provider_reference = ?2, updated_at = ?3 WHERE id = ?1")
      .bind(paymentId, init.paymentToken, nowIso)
      .run();

    return {
      payment: paymentView(await findByMerchantTransactionId(this.db, mti)),
      payment_url: init.paymentUrl,
      simulation: false,
    };
  }

  // -----------------------------------------------------------------
  // RÈGLEMENT — service partagé webhook réel / simulation staging.
  // -----------------------------------------------------------------
  async settleFromProvider(input: {
    source: "webhook" | "simulation";
    merchantTransactionId: string;
    /** référence d'événement (rejeu) : cpm_payid pour le webhook */
    eventReference: string | null;
    /** résultat du /v2/payment/check officiel (webhook réel uniquement) */
    check?: CheckResult;
    /** issue demandée par le simulateur (staging uniquement) */
    simulatedOutcome?: "success" | "failure";
  }): Promise<SettleOutcome> {
    const nowIso = toIso(this.clock.now());
    const eventId = crypto.randomUUID();

    // 1) Journal de réception + protection anti-rejeu.
    const firstReceipt = await recordWebhookReceipt(this.db, {
      id: eventId,
      provider: "cinetpay",
      event_reference: input.eventReference,
      merchant_transaction_id: input.merchantTransactionId,
      status: "RECEIVED",
      received_at: nowIso,
      processed_at: null,
      error_code: null,
    });
    if (!firstReceipt) {
      await finishWebhookEvent(
        this.db,
        eventId,
        "DUPLICATE",
        nowIso,
        "EVENT_REPLAY",
      ).catch(() => undefined);
      return { credited: false, already: false, duplicate: true, reason: "EVENT_REPLAY" };
    }

    // 2) Transaction connue ?
    const payment = await findByMerchantTransactionId(
      this.db,
      input.merchantTransactionId,
    );
    if (payment === null) {
      await finishWebhookEvent(this.db, eventId, "REJECTED", nowIso, "UNKNOWN_TRANSACTION");
      return { credited: false, already: false, duplicate: false, reason: "UNKNOWN_TRANSACTION" };
    }

    // 3) Idempotence : déjà confirmé → aucun nouveau crédit.
    if (payment.payment_status === "PAID") {
      await finishWebhookEvent(this.db, eventId, "PROCESSED", nowIso, "ALREADY_PAID");
      return { credited: false, already: true, duplicate: false, reason: "ALREADY_PAID" };
    }

    // 4) Faits vérifiés.
    let verdict:
      | { kind: "confirmed"; providerTransactionId: string | null }
      | { kind: "rejected"; reason: string }
      | { kind: "pending"; reason: string };

    if (input.source === "webhook") {
      if (this.cfg.cinetpayEnabled !== "true" || !this.cfg.cinetpayApiKey || !this.cfg.cinetpaySiteId) {
        // Fournisseur non configuré : VÉRIFICATION IMPOSSIBLE → aucun crédit.
        await finishWebhookEvent(this.db, eventId, "REJECTED", nowIso, "PROVIDER_NOT_CONFIGURED");
        await this.rejectPayment(payment, nowIso, "PROVIDER_NOT_CONFIGURED");
        return {
          credited: false, already: false, duplicate: false,
          reason: "PROVIDER_NOT_CONFIGURED",
        };
      }
      const client = new CinetPayClient(
        this.cfg.cinetpayApiKey,
        this.cfg.cinetpaySiteId,
        this.cfg.cinetpayApiBase,
      );
      const check = input.check ?? (await client.checkPayment(payment.merchant_transaction_id));
      verdict = verifyCinetPayPayment({
        check,
        expectedMerchantTransactionId: payment.merchant_transaction_id,
        expectedAmount: payment.amount,
        expectedCurrency: payment.currency,
        expectedSiteId: this.cfg.cinetpaySiteId,
      });
    } else {
      // Simulation : mêmes règles métier, faits issus de l'enregistrement
      // serveur (le simulateur ne choisit NI montant NI crédits).
      if (this.cfg.paymentMode !== "simulation") {
        await finishWebhookEvent(this.db, eventId, "REJECTED", nowIso, "SIMULATION_DISABLED");
        return {
          credited: false, already: false, duplicate: false,
          reason: "SIMULATION_DISABLED",
        };
      }
      verdict =
        input.simulatedOutcome === "failure"
          ? { kind: "rejected", reason: "PROVIDER_STATUS_REFUSED" }
          : {
              kind: "confirmed",
              providerTransactionId: `SIM-${payment.merchant_transaction_id}`,
            };
    }

    // 5) Rejets et attentes : AUCUN crédit.
    if (verdict.kind === "rejected") {
      await finishWebhookEvent(this.db, eventId, "REJECTED", nowIso, verdict.reason);
      await this.rejectPayment(payment, nowIso, verdict.reason);
      await recordDeviceEvent(this.db, {
        id: crypto.randomUUID(),
        terminalId: payment.terminal_id,
        eventType: "payment_rejected",
        occurredAt: nowIso,
        metadata: { reason: verdict.reason, source: input.source },
      });
      return {
        credited: false, already: false, duplicate: false, reason: verdict.reason,
      };
    }
    if (verdict.kind === "pending") {
      await finishWebhookEvent(this.db, eventId, "REJECTED", nowIso, verdict.reason);
      return {
        credited: false, already: false, duplicate: false, reason: verdict.reason,
      };
    }

    // 6) Confirmation authentique.
    //    Étape A — « gain » atomique du droit de créditer : l'UPDATE ne
    //    réussit que si le paiement est encore PENDING. Un webhook
    //    concurrent perdant obtient changes=0 → already (jamais deux lots
    //    pour un même paiement).
    //    Étape B — écritures du lot (transaction batch D1).
    //    NOTE D1 : les CTE « data-modifying » sont refusées par le parseur
    //    D1/workerd — d'où ce pattern en deux étapes gardées.
    const plan = findPlan(payment.product_code) as Plan;
    const now = this.clock.now();
    const startsAt = toIso(now);
    const expiresAt =
      plan.duration_s === null
        ? null
        : toIso(new Date(now.getTime() + plan.duration_s * 1000));
    const grantId = crypto.randomUUID();

    const win = await this.db
      .prepare(
        `UPDATE payments
            SET payment_status = 'PAID',
                provider_transaction_id = COALESCE(?2, provider_transaction_id),
                confirmed_at = ?3,
                updated_at = ?3
          WHERE id = ?1 AND payment_status = 'PENDING'`,
      )
      .bind(payment.id, verdict.providerTransactionId, nowIso)
      .run();

    if ((win.meta.changes ?? 0) === 0) {
      // Concurrent confirmé entre-temps : paiement déjà PAID.
      await finishWebhookEvent(this.db, eventId, "PROCESSED", nowIso, "ALREADY_PAID_RACE");
      return {
        credited: false, already: true, duplicate: false, reason: "ALREADY_PAID_RACE",
      };
    }

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO credit_grants
             (id, terminal_id, grant_type, product_code, credits_total,
              credits_remaining, starts_at, expires_at, status, payment_id, created_at)
           VALUES (?1, ?2, 'pass', ?3, ?4, ?4, ?5, ?6, 'active', ?7, ?5)`,
        )
        .bind(
          grantId, payment.terminal_id, payment.product_code, plan.credits,
          startsAt, expiresAt, payment.id,
        ),
      this.db
        .prepare(
          `INSERT INTO device_events (id, terminal_id, event_type, occurred_at, metadata)
           VALUES (?1, ?2, 'payment_confirmed', ?3, ?4)`,
        )
        .bind(
          crypto.randomUUID(), payment.terminal_id, startsAt,
          JSON.stringify({
            product_code: payment.product_code,
            credits: plan.credits,
            source: input.source,
          }),
        ),
      this.db
        .prepare(
          `INSERT INTO device_events (id, terminal_id, event_type, occurred_at, metadata)
           VALUES (?1, ?2, 'grant_created', ?3, ?4)`,
        )
        .bind(
          crypto.randomUUID(), payment.terminal_id, startsAt,
          JSON.stringify({ grant_id: grantId, credits: plan.credits }),
        ),
      this.db
        .prepare(
          `UPDATE payment_webhook_events
              SET status = 'PROCESSED', processed_at = ?2, error_code = NULL
            WHERE id = ?1`,
        )
        .bind(eventId, nowIso),
    ]);

    return {
      credited: true,
      already: false,
      duplicate: false,
      grant: { credits: plan.credits, expires_at: expiresAt },
    };
  }

  private async rejectPayment(
    payment: PaymentRow,
    nowIso: string,
    reason: string,
  ): Promise<void> {
    // Échec définitif côté fournisseur → FAILED. Sinon on conserve
    // PENDING (réessayable) et on ne journalise que le motif.
    const definitive =
      reason.startsWith("PROVIDER_STATUS_") ||
      reason === "AMOUNT_MISMATCH" ||
      reason === "CURRENCY_MISMATCH" ||
      reason === "SITE_MISMATCH";
    if (definitive) {
      await updatePaymentStatus(this.db, payment.id, "FAILED", nowIso);
    }
  }
}

function paymentView(p: PaymentRow | null): InitiateResult["payment"] {
  if (p === null) throw new ApiError("INTERNAL_ERROR", "Paiement illisible.");
  const row: PaymentRow = p;
  return {
    id: row.id,
    merchant_transaction_id: row.merchant_transaction_id,
    product_code: row.product_code,
    amount: row.amount,
    currency: "XOF",
    payment_status: row.payment_status,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

/** Référence marchande unique, générée par le serveur. */
export function generateMerchantTransactionId(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "T");
  const rand = [...crypto.getRandomValues(new Uint8Array(6))]
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .slice(0, 10);
  return `VVL-${stamp}-${rand}`;
}
