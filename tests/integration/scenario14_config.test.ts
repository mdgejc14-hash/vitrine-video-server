import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { SystemClock } from "../../src/clock/clock";
import { PaymentService } from "../../src/services/paymentService";
import { TerminalService } from "../../src/services/terminalService";
import { settle as settleRoute } from "../../src/routes/simulation";
import { bootstrap, androidId, ADMIN_TOKEN, postJson, get } from "./helpers";

const TEST_HMAC_SECRET = "test-hmac-secret-0123456789abcdef0123456789abcdef";

// Test 14 — CinetPay non configuré :
//  - initiate en mode réel sans clés → PAYMENT_PROVIDER_NOT_CONFIGURED ;
//  - aucun crédit ajouté ;
//  - simulation staging opérationnelle ;
//  - simulation production INACCESSIBLE (404).

async function newTerminalId(): Promise<{ androidId: string; terminalId: string }> {
  const id = androidId(`t14-${Math.random().toString(36).slice(2, 8)}`);
  await bootstrap(id);
  const svc = new TerminalService(env.DB, new SystemClock(), TEST_HMAC_SECRET);
  const terminal = await svc.identify(id);
  return { androidId: id, terminalId: terminal.id };
}

function paymentSvcReal(): PaymentService {
  return new PaymentService(env.DB, new SystemClock(), {
    paymentMode: "real",
    cinetpayEnabled: "false", // réalité actuelle : aucune clé CinetPay
  });
}

describe("Test 14 — CinetPay non configuré", () => {
  it("initiation en mode réel désactivé → PAYMENT_PROVIDER_NOT_CONFIGURED, aucun crédit", async () => {
    const { terminalId } = await newTerminalId();
    const svc = paymentSvcReal();
    await expectAsyncRejection(
      () => svc.initiate(terminalId, "PASS_EXPRESS"),
      "PAYMENT_PROVIDER_NOT_CONFIGURED",
    );
    const grants = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'")
      .bind(terminalId)
      .first<{ n: number }>();
    expect(grants?.n).toBe(0);
  });

  it("webhook entrant sans configuration → rejet, aucun crédit", async () => {
    const { terminalId } = await newTerminalId();
    // Préparer une transaction PENDING via la simulation (service partagé).
    const simSvc = new PaymentService(env.DB, new SystemClock(), {
      paymentMode: "simulation",
      cinetpayEnabled: "false",
    });
    const init = await simSvc.initiate(terminalId, "PASS_PRO");

    // Webhook réel (source webhook) sans clés : refus.
    const realSvc = paymentSvcReal();
    const out = await realSvc.settleFromProvider({
      source: "webhook",
      merchantTransactionId: init.payment.merchant_transaction_id,
      eventReference: "EV-T14-1",
    });
    expect(out.credited).toBe(false);
    expect(out.reason).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("simulation staging OPÉRATIONNELLE (route /__test__/payments/settle)", async () => {
    const { androidId: id, terminalId } = await newTerminalId();
    const simSvc = new PaymentService(env.DB, new SystemClock(), {
      paymentMode: "simulation",
      cinetpayEnabled: "false",
    });
    const init = await simSvc.initiate(terminalId, "PASS_EXPRESS");
    const out = await simSvc.settleFromProvider({
      source: "simulation",
      merchantTransactionId: init.payment.merchant_transaction_id,
      eventReference: `SIM-${init.payment.merchant_transaction_id}`,
      simulatedOutcome: "success",
    });
    expect(out.credited).toBe(true);
    void id;
  });

  it("la route de simulation REFUSE l'environnement production (404 SIMULATION_DISABLED)", async () => {
    // Handler direct avec un env production simulé (DB réelle de test).
    const productionEnv = Object.create(env) as Env;
    productionEnv.ENVIRONMENT = "production";
    productionEnv.PAYMENT_MODE = "disabled";

    const request = new Request("https://worker.test/__test__/payments/settle", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-simulation-secret-0123456789abcdef",
      },
      body: JSON.stringify({ merchant_transaction_id: "VVL-X", outcome: "success" }),
    });
    let status = 0;
    let code = "";
    try {
      const res = await settleRoute(request, productionEnv, new SystemClock());
      status = res.status;
      code = ((await res.json()) as any).error.code;
    } catch (e) {
      // le handler lève une ApiError — le routeur la convertit en 404
      status = (e as any)?.status ?? 0;
      code = (e as any)?.code ?? "";
    }
    expect(status === 404 || code === "SIMULATION_DISABLED").toBe(true);
    expect(code).toBe("SIMULATION_DISABLED");
  });

  it("la route de simulation exige le secret (401 sans/mauvais secret)", async () => {
    const sans = await postJson("/__test__/payments/settle", {
      merchant_transaction_id: "VVL-X",
      outcome: "success",
    });
    expect(sans.status).toBe(401);
    const mauvais = await postJson(
      "/__test__/payments/settle",
      { merchant_transaction_id: "VVL-X", outcome: "success" },
      { authorization: "Bearer mauvais-secret" },
    );
    expect(mauvais.status).toBe(401);
  });

  it("admin metrics protégé : 401 sans token, 401 mauvais token, 200 bon token", async () => {
    const sans = await get("/v1/admin/metrics");
    expect(sans.status).toBe(401);
    const mauvais = await get("/v1/admin/metrics", {
      authorization: "Bearer mauvais-token-admin",
    });
    expect(mauvais.status).toBe(401);
    const bon = await get("/v1/admin/metrics", {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    expect(bon.status).toBe(200);
    const body = (await bon.json()) as any;
    expect(body.terminals).toBeDefined();
    expect(body.revenue).toBeDefined();
  });
});

async function expectAsyncRejection(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(`attendait une rejet ${code}`);
  } catch (err) {
    expect((err as any)?.code).toBe(code);
  }
}
