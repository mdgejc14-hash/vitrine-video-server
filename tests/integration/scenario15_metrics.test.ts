import { describe, expect, it } from "vitest";
import { bootstrap, authorize, buyPass, initiate, settle, androidId, get, ADMIN_TOKEN } from "./helpers";

// Test 15 — statistiques administratives agrégées.
// Aucun terminal ne doit être compté deux fois (bootstrap répété = 1).

describe("Test 15 — statistiques administratives", () => {
  it("métriques exactes après un scénario complet", async () => {
    // Terminal A : bootstrap (×2 pour prouver l'unicité), 1 export.
    const a = androidId("t15-ter-a");
    await bootstrap(a);
    await bootstrap(a); // re-bootstrap : même terminal, pas de double comptage
    await authorize(a, "ad-t15-a-1");

    // Terminal B : bootstrap, Pass Express, 2 exports.
    const b = androidId("t15-ter-b");
    await bootstrap(b);
    await buyPass(b, "PASS_EXPRESS");
    await authorize(b, "ad-t15-b-1");
    await authorize(b, "ad-t15-b-2");

    // Terminal C : bootstrap, Pass Pro initié PUIS échoué (FAILED).
    const c = androidId("t15-ter-c");
    await bootstrap(c);
    const initC = await initiate(c, "PASS_PRO");
    await settle(initC.body.payment.merchant_transaction_id, "failure");

    // Terminal D : bootstrap, Pass Boutique, 1 export.
    const d = androidId("t15-ter-d");
    await bootstrap(d);
    await buyPass(d, "PASS_BOUTIQUE");
    await authorize(d, "ad-t15-d-1");

    const res = await get("/v1/admin/metrics", {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    expect(res.status).toBe(200);
    const m = (await res.json()) as any;

    // 4 terminaux exactement (le re-bootstrap de A ne double pas).
    expect(m.terminals.initialized).toBe(4);
    expect(m.terminals.active_last_30d).toBe(4);

    // Crédits gratuits attribués : 4 terminaux × 3 = 12.
    expect(m.credits.free_granted_total).toBe(12);
    // Exports autorisés : 4 au total.
    expect(m.credits.exports_authorized).toBe(4);
    // Crédits consommés : A=1, B=2, C=0, D=1 → 4.
    expect(m.credits.credits_consumed_total).toBe(4);

    // Paiements : B PAID (Express), C FAILED (Pro), D PAID (Boutique).
    expect(m.payments.confirmed).toBe(2);
    expect(m.payments.failed).toBe(1);
    expect(m.payments.pending).toBe(0);
    expect(m.payments.cancelled).toBe(0);

    // Ventes par formule.
    expect(m.sales.PASS_EXPRESS).toBe(1);
    expect(m.sales.PASS_PRO).toBe(0); // échoué → non vendu
    expect(m.sales.PASS_BOUTIQUE).toBe(1);

    // Revenus réellement confirmés : 500 + 7500 = 8000 XOF.
    expect(m.revenue.confirmed_xof).toBe(8_000);
    expect(m.revenue.currency).toBe("XOF");

    // Aucune donnée individuelle : pas de hash, pas d'identifiants bruts.
    const serialized = JSON.stringify(m);
    expect(serialized.includes("device_hash")).toBe(false);
    for (const id of [a, b, c, d]) {
      expect(serialized.includes(id)).toBe(false);
    }
  });

  it("métriques inaccessibles sans token (401)", async () => {
    const res = await get("/v1/admin/metrics");
    expect(res.status).toBe(401);
  });

  it("/health et /ready reflètent l'état du service", async () => {
    const health = await get("/health");
    expect(health.status).toBe(200);
    const h = (await health.json()) as any;
    expect(h.status).toBe("ok");
    expect(h.environment).toBe("staging");
    expect(h.payment_mode).toBe("simulation");

    const ready = await get("/ready");
    expect(ready.status).toBe(200);
    const r = (await ready.json()) as any;
    expect(r.ready).toBe(true);
    expect(r.database).toBe("connected");
  });
});
