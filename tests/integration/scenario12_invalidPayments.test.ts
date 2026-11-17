import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { SystemClock } from "../../src/clock/clock";
import { PaymentService } from "../../src/services/paymentService";
import { TerminalService } from "../../src/services/terminalService";
import type { CheckResult } from "../../src/payments/cinetpay";
import { bootstrap, androidId, db, postForm } from "./helpers";

const TEST_HMAC_SECRET = "test-hmac-secret-0123456789abcdef0123456789abcdef";

// Test 12 — paiements invalides : AUCUN crédit dans tous ces cas.
// Le webhook réel reçoit un /check du fournisseur ; ici le résultat du
// /check est injecté directement au service (point d'injection officiel du
// client CinetPay) — les vérifications métier sont celles du code réel.

function check(partial: Partial<CheckResult>): CheckResult {
  return {
    callable: true,
    result: "00",
    status: "ACCEPTED",
    amount: 500,
    currency: "XOF",
    siteId: "TESTSITE123",
    providerPaymentId: `CP-${Math.random().toString(36).slice(2, 10)}`,
    paymentDate: "2026-11-17T12:00:00.000Z",
    signature: "sig-abc",
    raw: {},
    ...partial,
  };
}

async function newTerminal(): Promise<{ id: string; terminalId: string }> {
  const id = androidId(`t12-${Math.random().toString(36).slice(2, 8)}`);
  await bootstrap(id);
  const svc = new TerminalService(env.DB, new SystemClock(), TEST_HMAC_SECRET);
  const terminal = await svc.identify(id);
  return { id, terminalId: terminal.id };
}

async function initiatePass(
  terminalId: string,
  productCode = "PASS_EXPRESS",
): Promise<string> {
  const svc = new PaymentService(env.DB, new SystemClock(), {
    paymentMode: "simulation",
    cinetpayEnabled: "false",
  });
  const init = await svc.initiate(terminalId, productCode);
  return init.payment.merchant_transaction_id;
}

async function paidRemaining(terminalId: string): Promise<number> {
  const rows = await db()
    .prepare(
      "SELECT COALESCE(SUM(credits_remaining), 0) AS n FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'",
    )
    .bind(terminalId)
    .first<{ n: number }>();
  return rows?.n ?? 0;
}

function settleWithCheck(mti: string, checkResult: CheckResult, eventRef = `EV-${Math.random()}`) {
  const svc = new PaymentService(env.DB, new SystemClock(), {
    paymentMode: "real",
    cinetpayEnabled: "true",
    cinetpayApiKey: "test-api-key",
    cinetpaySiteId: "TESTSITE123",
  });
  return svc.settleFromProvider({
    source: "webhook",
    merchantTransactionId: mti,
    eventReference: eventRef,
    check: checkResult,
  });
}

describe("Test 12 — paiements invalides : aucun crédit", () => {
  it("mauvais MONTANT (499 au lieu de 500) → rejet AMOUNT_MISMATCH", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const out = await settleWithCheck(mti, check({ amount: 499 }));
    expect(out.credited).toBe(false);
    expect(out.reason).toBe("AMOUNT_MISMATCH");
    expect(await paidRemaining(terminalId)).toBe(0);
  });

  it("mauvaise DEVISE (GHS) → rejet CURRENCY_MISMATCH", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const out = await settleWithCheck(mti, check({ currency: "GHS" }));
    expect(out.reason).toBe("CURRENCY_MISMATCH");
    expect(await paidRemaining(terminalId)).toBe(0);
  });

  it("mauvais SITE (site_id différent) → rejet SITE_MISMATCH", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const out = await settleWithCheck(mti, check({ siteId: "AUTRE-SITE" }));
    expect(out.reason).toBe("SITE_MISMATCH");
    expect(await paidRemaining(terminalId)).toBe(0);
  });

  it("check fournisseur INJOIGNABLE → rejet PROVIDER_CHECK_UNAVAILABLE", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const out = await settleWithCheck(mti, check({ callable: false, status: null, amount: null }));
    expect(out.reason).toBe("PROVIDER_CHECK_UNAVAILABLE");
    expect(await paidRemaining(terminalId)).toBe(0);
  });

  it("code fournisseur ≠ 00 (ex. 611) → rejet", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const out = await settleWithCheck(mti, check({ result: "611" }));
    expect(out.reason).toBe("PROVIDER_CODE_611");
    expect(await paidRemaining(terminalId)).toBe(0);
  });

  it("statut REFUSED → échec définitif, paiement FAILED", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const out = await settleWithCheck(mti, check({ status: "REFUSED" }));
    expect(out.credited).toBe(false);
    expect(out.reason).toBe("PROVIDER_STATUS_REFUSED");
    expect(await paidRemaining(terminalId)).toBe(0);
    const payment = await db()
      .prepare("SELECT payment_status FROM payments WHERE merchant_transaction_id = ?1")
      .bind(mti)
      .first<{ payment_status: string }>();
    expect(payment?.payment_status).toBe("FAILED");
  });

  it("statuts CANCELLED et FAILED → aucun crédit", async () => {
    for (const status of ["CANCELLED", "FAILED"]) {
      const { terminalId } = await newTerminal();
      const mti = await initiatePass(terminalId);
      const out = await settleWithCheck(mti, check({ status }));
      expect(out.credited).toBe(false);
      expect(await paidRemaining(terminalId)).toBe(0);
    }
  });

  it("statut PENDING (non payé, non définitif) → aucun crédit, paiement reste PENDING", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const out = await settleWithCheck(mti, check({ status: "PENDING" }));
    expect(out.credited).toBe(false);
    expect(out.reason).toBe("PROVIDER_STATUS_PENDING");
    const payment = await db()
      .prepare("SELECT payment_status FROM payments WHERE merchant_transaction_id = ?1")
      .bind(mti)
      .first<{ payment_status: string }>();
    expect(payment?.payment_status).toBe("PENDING");
  });

  it("transaction INCONNUE → rejet UNKNOWN_TRANSACTION", async () => {
    const out = await settleWithCheck("VVL-INEXISTANT-000000", check({}));
    expect(out.reason).toBe("UNKNOWN_TRANSACTION");
  });

  it("webhook RÉPÉTÉ (même event_reference) → DUPLICATE, aucun crédit supplémentaire", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const ok = await settleWithCheck(mti, check({}), "EV-REPLAY-1");
    expect(ok.credited).toBe(true);
    const replay = await settleWithCheck(mti, check({}), "EV-REPLAY-1");
    expect(replay.duplicate).toBe(true);
    expect(replay.credited).toBe(false);
    expect(await paidRemaining(terminalId)).toBe(6); // pas doublé
  });

  it("webhook REJOUÉ sur transaction DÉJÀ CRÉDITÉE → already, aucun double crédit", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const ok = await settleWithCheck(mti, check({}), "EV-ALREADY-1");
    expect(ok.credited).toBe(true);
    const again = await settleWithCheck(mti, check({}), "EV-ALREADY-2");
    expect(again.credited).toBe(false);
    expect(again.already).toBe(true);
    expect(await paidRemaining(terminalId)).toBe(6);
  });

  it("deux webhooks CONCURRENTS (references distinctes) → un seul lot de crédits", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const results = await Promise.all([
      settleWithCheck(mti, check({}), "EV-RACE-1"),
      settleWithCheck(mti, check({}), "EV-RACE-2"),
      settleWithCheck(mti, check({}), "EV-RACE-3"),
    ]);
    const credited = results.filter((r) => r.credited).length;
    expect(credited).toBe(1);
    expect(await paidRemaining(terminalId)).toBe(6); // jamais doublé
  });

  it("webhook SANS configuration fournisseur → PROVIDER_NOT_CONFIGURED, aucun crédit", async () => {
    const { terminalId } = await newTerminal();
    const mti = await initiatePass(terminalId);
    const svc = new PaymentService(env.DB, new SystemClock(), {
      paymentMode: "real",
      cinetpayEnabled: "false", // aucune clé CinetPay configurée
    });
    const out = await svc.settleFromProvider({
      source: "webhook",
      merchantTransactionId: mti,
      eventReference: "EV-NOCONF-1",
    });
    expect(out.credited).toBe(false);
    expect(out.reason).toBe("PROVIDER_NOT_CONFIGURED");
    expect(await paidRemaining(terminalId)).toBe(0);
  });

  it("webhook HTTP : cpm_trans_id manquant → 400, cpm_trans_id inconnu → rejet", async () => {
    const vide = await postForm("/v1/payments/cinetpay/webhook", "");
    expect(vide.status).toBe(400);

    const body = new URLSearchParams({
      cpm_trans_id: "VVL-INCONNU-123",
      cpm_site_id: "X",
    }).toString();
    const inconnu = await postForm("/v1/payments/cinetpay/webhook", body);
    expect(inconnu.status).toBe(200); // traité (rejeté) sans crash
    const json = (await inconnu.json()) as any;
    expect(json.credited).toBe(false);
    // Transaction inconnue : rejetée AVANT toute considération de
    // configuration (UNKNOWN_TRANSACTION) — aucun crédit dans tous les cas.
    expect(json.reason).toBe("UNKNOWN_TRANSACTION");
  });
});
