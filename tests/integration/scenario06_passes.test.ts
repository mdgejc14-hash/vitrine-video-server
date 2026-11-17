import { describe, expect, it } from "vitest";
import { bootstrap, me, authorize, initiate, settle, buyPass, androidId, db, postJson, device } from "./helpers";

// Test 6 — Pass Express (500 XOF, 6 crédits, 24 h).
// Test 8 — Pass Pro (3 000 XOF, 90 crédits, 30 jours).
// Test 10 — Pass Boutique (7 500 XOF, 200 crédits, 30 jours).
// Test 13 — Plusieurs pass : lots indépendants, expirations distinctes,
//           consommation du lot payant qui expire le plus tôt,
//           préservation des crédits gratuits.
//
// NOTE D'INTERPRÉTATION (documentée dans REPORT_SERVER_FINAL.md) :
// « Six exports autorisés, septième refusé » suppose que les crédits
// gratuits du terminal sont déjà épuisés — sinon la règle §4.4 (les
// gratuits prennent le relais après épuisement des payants) autoriserait
// le septième. Les deux réalités sont testées ici.

async function countAuthorizations(terminalId: string): Promise<number> {
  const r = await db()
    .prepare("SELECT COUNT(*) AS n FROM export_authorizations WHERE terminal_id = ?1")
    .bind(terminalId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

function expectLot(row: {
  credits_total: number;
  starts_at: string;
  expires_at: string | null;
}, expected: { credits: number; duration_s: number | null }) {
  expect(row.credits_total).toBe(expected.credits);
  if (expected.duration_s === null) {
    expect(row.expires_at).toBeNull();
  } else {
    // Durée EXACTE du lot : expires_at - starts_at (tous deux stockés).
    const deltaMs = Date.parse(row.expires_at!) - Date.parse(row.starts_at);
    expect(deltaMs).toBe(expected.duration_s * 1000);
  }
}

describe("Test 6 — Pass Express", () => {
  it("paiement 500 XOF confirmé → 6 crédites, validité 86 400 s exactement", async () => {
    const id = androidId("test6-express");
    await bootstrap(id);
    const mti = await buyPass(id, "PASS_EXPRESS");

    const payment = await db()
      .prepare("SELECT * FROM payments WHERE merchant_transaction_id = ?1")
      .bind(mti)
      .first<any>();
    expect(payment.amount).toBe(500);
    expect(payment.currency).toBe("XOF");
    expect(payment.payment_status).toBe("PAID");
    expect(payment.confirmed_at).not.toBeNull();

    const solde = await me(id);
    expect(solde.credits.paid_remaining).toBe(6);
    expect(solde.credits.free_remaining).toBe(3); // préservés (§4.4)
    expect(solde.credits.total_usable).toBe(9);

    const lot = await db()
      .prepare(
        "SELECT * FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'",
      )
      .bind((solde.terminal as { id: string }).id)
      .first<any>();
    expectLot(lot, { credits: 6, duration_s: 86_400 });
    expect(lot.product_code).toBe("PASS_EXPRESS");
  });

  it("les 6 exports du pass sont autorisés, puis les gratuits prennent le relais (§4.4)", { timeout: 30_000 }, async () => {
    const id = androidId("test6-relais");
    await bootstrap(id);
    await buyPass(id, "PASS_EXPRESS");

    for (let i = 1; i <= 6; i++) {
      const r = await authorize(id, `ad-test6-${i}`);
      expect(r.status).toBe(201);
      // Tant que le lot payant a des crédits, les gratuits sont préservés.
      const s = await me(id);
      expect(s.credits.free_remaining).toBe(3);
    }
    // Lot payant épuisé : le 7e export EST autorisé sur les gratuits.
    const septieme = await authorize(id, "ad-test6-7");
    expect(septieme.status).toBe(201);
    expect(septieme.body.credits.free_remaining).toBe(2);
    expect(septieme.body.credits.paid_remaining).toBe(0);
  });

  it("variante « 7e refusé » : terminal sans crédits gratuits restants", { timeout: 30_000 }, async () => {
    const id = androidId("test6-septieme-refuse");
    await bootstrap(id);
    // Épuisement préalable des crédits gratuits.
    for (let i = 1; i <= 3; i++) await authorize(id, `ad-test6v-pre-${i}`);
    expect((await me(id)).credits.total_usable).toBe(0);

    await buyPass(id, "PASS_EXPRESS");
    for (let i = 1; i <= 6; i++) {
      const r = await authorize(id, `ad-test6v-${i}`);
      expect(r.status).toBe(201);
    }
    const septieme = await authorize(id, "ad-test6v-7");
    expect(septieme.status).toBe(402);
    expect(septieme.body.error.code).toBe("INSUFFICIENT_CREDITS");
  });
});

describe("Test 8 — Pass Pro", () => {
  it("paiement 3 000 XOF confirmé → 90 crédits, validité 2 592 000 s exactement, 91e refusé", { timeout: 60_000 }, async () => {
    const id = androidId("test8-pro");
    await bootstrap(id);
    const mti = await buyPass(id, "PASS_PRO");
    const payment = await db()
      .prepare("SELECT amount, payment_status FROM payments WHERE merchant_transaction_id = ?1")
      .bind(mti)
      .first<any>();
    expect(payment.amount).toBe(3_000);
    expect(payment.payment_status).toBe("PAID");

    const solde = await me(id);
    expect(solde.credits.paid_remaining).toBe(90);

    const lot = await db()
      .prepare(
        "SELECT * FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'",
      )
      .bind((solde.terminal as { id: string }).id)
      .first<any>();
    expectLot(lot, { credits: 90, duration_s: 2_592_000 });

    // Épuisement préalable des gratuits, puis 90 exports payants.
    for (let i = 1; i <= 3; i++) await authorize(id, `ad-test8-pre-${i}`);
    for (let i = 1; i <= 90; i++) {
      const r = await authorize(id, `ad-test8-${i}`);
      expect(r.status).toBe(201);
    }
    const quatreVingtOnzieme = await authorize(id, "ad-test8-91");
    expect(quatreVingtOnzieme.status).toBe(402);
    expect(await countAuthorizations((await me(id)).terminal.id)).toBe(93); // 3 + 90
  });
});

describe("Test 10 — Pass Boutique", () => {
  it("paiement 7 500 XOF confirmé → 200 crédits, validité 2 592 000 s, 201e refusé", { timeout: 120_000 }, async () => {
    const id = androidId("test10-boutique");
    await bootstrap(id);
    const mti = await buyPass(id, "PASS_BOUTIQUE");
    const payment = await db()
      .prepare("SELECT amount FROM payments WHERE merchant_transaction_id = ?1")
      .bind(mti)
      .first<any>();
    expect(payment.amount).toBe(7_500);

    const solde = await me(id);
    expect(solde.credits.paid_remaining).toBe(200);

    const lot = await db()
      .prepare(
        "SELECT * FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'",
      )
      .bind((solde.terminal as { id: string }).id)
      .first<any>();
    expectLot(lot, { credits: 200, duration_s: 2_592_000 });

    for (let i = 1; i <= 3; i++) await authorize(id, `ad-test10-pre-${i}`);
    for (let i = 1; i <= 200; i++) {
      const r = await authorize(id, `ad-test10-${i}`);
      expect(r.status, `export ${i}`).toBe(201);
    }
    const vingtetunieme = await authorize(id, "ad-test10-201");
    expect(vingtetunieme.status).toBe(402);
  });
});

describe("Test 13 — plusieurs pass superposés", () => {
  it("lots indépendants, expirations distinctes, Express consommé avant Pro, gratuits préservés", { timeout: 60_000 }, async () => {
    const id = androidId("test13-multi");
    await bootstrap(id);

    // Achat Express PUIS Pro : Express expire plus tôt.
    await buyPass(id, "PASS_EXPRESS");
    await buyPass(id, "PASS_PRO");

    const term = (await me(id)).terminal as { id: string };
    const lots = await db()
      .prepare(
        `SELECT * FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'
         ORDER BY expires_at ASC`,
      )
      .bind(term.id)
      .all<any>();
    const rows = lots.results ?? [];
    expect(rows.length).toBe(2);
    expect(Date.parse(rows[0]!.expires_at)).toBeLessThan(Date.parse(rows[1]!.expires_at));
    expect(rows[0]!.product_code).toBe("PASS_EXPRESS");
    expect(rows[1]!.product_code).toBe("PASS_PRO");

    // Le débit vient TOUJOURS du lot payant qui expire le plus tôt.
    for (let i = 1; i <= 6; i++) {
      await authorize(id, `ad-test13-${i}`);
      const expressRow = await db()
        .prepare(
          "SELECT credits_remaining FROM credit_grants WHERE terminal_id = ?1 AND product_code = 'PASS_EXPRESS'",
        )
        .bind(term.id)
        .first<any>();
      expect(expressRow.credits_remaining).toBe(6 - i);
    }
    const solde = await me(id);
    expect(solde.credits.free_remaining).toBe(3); // toujours préservés
    expect(solde.credits.paid_remaining).toBe(90); // Pro intact

    // Après épuisement d'Express : le débit passe sur Pro (toujours payant
    // valide le plus tôt).
    await authorize(id, "ad-test13-7");
    const proRow = await db()
      .prepare(
        "SELECT credits_remaining FROM credit_grants WHERE terminal_id = ?1 AND product_code = 'PASS_PRO'",
      )
      .bind(term.id)
      .first<any>();
    expect(proRow.credits_remaining).toBe(89);
    expect(solde.credits.free_remaining).toBe(3);
  });

  it("les achats successifs ne prolongent JAMAIS les anciens lots", async () => {
    const id = androidId("test13-independance");
    await bootstrap(id);
    const term2 = (await me(id)).terminal as { id: string };
    await buyPass(id, "PASS_EXPRESS");
    const expressAvant = await db()
      .prepare(
        "SELECT credits_total, starts_at, expires_at FROM credit_grants WHERE terminal_id = ?1 AND product_code = 'PASS_EXPRESS'",
      )
      .bind(term2.id)
      .first<any>();

    await buyPass(id, "PASS_BOUTIQUE");

    const expressApres = await db()
      .prepare(
        "SELECT credits_total, starts_at, expires_at FROM credit_grants WHERE terminal_id = ?1 AND product_code = 'PASS_EXPRESS'",
      )
      .bind(term2.id)
      .first<any>();
    expect(expressApres.expires_at).toBe(expressAvant.expires_at); // inchangé
    expectLot(expressAvant, { credits: 6, duration_s: 86_400 });
  });
});

describe("initiation — valeurs fixées par le serveur", () => {
  it("le client ne peut pas choisir montant ou crédits : seul product_code est lu", async () => {
    const id = androidId("test-init-values");
    await bootstrap(id);
    // Tentative de forge : montant et crédits bidon ignorés.
    const res = await postJson(
      "/v1/payments/initiate",
      { product_code: "PASS_PRO", amount: 1, credits: 99999, price: "1 XOF" },
      device(id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.payment.amount).toBe(3_000); // catalogue serveur
    expect(body.payment.product_code).toBe("PASS_PRO");
    expect(body.simulation).toBe(true); // staging = simulation
  });

  it("produit invalide ou gratuit → 400 INVALID_PRODUCT", async () => {
    const id = androidId("test-init-invalide");
    await bootstrap(id);
    for (const code of ["FREE_INSTALL", "PASS_INEXISTANT", "", "pass_pro"]) {
      const r = await initiate(id, code);
      expect(r.status, `product_code=${code}`).toBe(400);
      expect(r.body.error.code).toBe("INVALID_PRODUCT");
    }
  });

  it("échec simulé → FAILED, aucun crédit", async () => {
    const id = androidId("test-init-echec");
    await bootstrap(id);
    const init = await initiate(id, "PASS_EXPRESS");
    const mti = init.body.payment.merchant_transaction_id as string;
    const done = await settle(mti, "failure");
    expect(done.body.credited).toBe(false);
    expect((await me(id)).credits.paid_remaining).toBe(0);

    const payment = await db()
      .prepare("SELECT payment_status FROM payments WHERE merchant_transaction_id = ?1")
      .bind(mti)
      .first<any>();
    expect(payment.payment_status).toBe("FAILED");
  });
});
