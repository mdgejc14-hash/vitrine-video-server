import { describe, expect, it } from "vitest";
import { bootstrap, authorize, me, androidId, postJson, device } from "./helpers";

// Test 2 — Trois exports gratuits : 3 → 2 → 1 → 0, puis 402.
// Test 3 — Idempotence et concurrence : même clé = une seule
// consommation ; deux demandes concurrentes sur le dernier crédit = une
// seule acceptée.

describe("Test 2 — trois exports gratuits puis refus", () => {
  it("décompte exact 3 → 2 → 1 → 0 puis HTTP 402 INSUFFICIENT_CREDITS", async () => {
    const id = androidId("test2-decompte");
    await bootstrap(id);

    const attendus = [2, 1, 0];
    for (let i = 1; i <= 3; i++) {
      const r = await authorize(id, `ad-test2-${i}`);
      expect(r.status).toBe(201);
      expect(r.body.replay).toBe(false);
      expect(r.body.rule).toBe("one_ad_one_credit");
      expect(r.body.credits.total_usable).toBe(attendus[i - 1]);
    }

    const quatrieme = await authorize(id, "ad-test2-4");
    expect(quatrieme.status).toBe(402);
    expect(quatrieme.body.error.code).toBe("INSUFFICIENT_CREDITS");
    // Le refus retourne les offres commerciales officielles.
    const plans = quatrieme.body.error.details.plans as Array<{ code: string }>;
    expect(plans.map((p) => p.code)).toEqual([
      "FREE_INSTALL",
      "PASS_EXPRESS",
      "PASS_PRO",
      "PASS_BOUTIQUE",
    ]);
  });

  it("l'authorization est retournée avec le solde après débit", async () => {
    const id = androidId("test2-shape");
    await bootstrap(id);
    const r = await authorize(id, "ad-test2-shape-1");
    expect(r.body.authorization).toMatchObject({
      status: "active",
      idempotency_key: "ad-test2-shape-1",
    });
    expect(typeof r.body.authorization.id).toBe("string");
    expect(typeof r.body.authorization.authorized_at).toBe("string");
  });

  it("Idempotency-Key absente ou invalide → 400", async () => {
    const id = androidId("test2-cle");
    await bootstrap(id);

    const absente = await postJson("/v1/exports/authorize", {}, device(id));
    expect(absente.status).toBe(400);
    expect(((await absente.json()) as any).error.code).toBe("MISSING_IDEMPOTENCY_KEY");

    const invalide = await authorize(id, "é!"); // caractères interdits
    expect(invalide.status).toBe(400);
    expect(invalide.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });
});

describe("Test 3 — idempotence : une publicité, un crédit", () => {
  it("la même clé retourne l'autorisation initiale SANS nouveau débit (replay)", async () => {
    const id = androidId("test3-idem");
    await bootstrap(id);

    const premier = await authorize(id, "ad-test3-meme-cle");
    expect(premier.status).toBe(201);
    expect(premier.body.replay).toBe(false);
    expect(premier.body.credits.total_usable).toBe(2);

    // L'application enregistre PUIS partage avec la MÊME clé : replay.
    const second = await authorize(id, "ad-test3-meme-cle");
    expect(second.status).toBe(200);
    expect(second.body.replay).toBe(true);
    expect(second.body.authorization.id).toBe(premier.body.authorization.id);
    expect(second.body.credits.total_usable).toBe(2); // aucun débit

    const troisieme = await authorize(id, "ad-test3-meme-cle");
    expect(troisieme.body.replay).toBe(true);
    expect(troisieme.body.credits.total_usable).toBe(2);
  });

  it("deux clés différentes = deux publicités différentes = deux débits", async () => {
    const id = androidId("test3-distinct");
    await bootstrap(id);
    await authorize(id, "ad-test3-video-A");
    const b = await authorize(id, "ad-test3-video-B");
    expect(b.status).toBe(201);
    expect(b.body.credits.total_usable).toBe(1);
  });

  it("N demandes CONCURRENTES avec la même clé → exactement un débit", async () => {
    const id = androidId("test3-concurrent-meme-cle");
    await bootstrap(id);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        authorize(id, "ad-test3-conc-cle-partagee"), // MÊME clé = même publicité
      ),
    );
    const created = results.filter((r) => r.status === 201);
    const replayed = results.filter((r) => r.status === 200);
    expect(created.length).toBe(1);
    expect(replayed.length).toBe(7);
    const solde = await (await import("./helpers")).me(id);
    expect(solde.credits.total_usable).toBe(2); // un seul crédit débité
  });

  it("deux demandes CONCURRENTES sur le DERNIER crédit → une seule acceptée, l'autre 402", async () => {
    const id = androidId("test3-dernier-credit");
    await bootstrap(id);
    await authorize(id, "ad-test3-premiere");
    await authorize(id, "ad-test3-deuxieme");
    // Il reste exactement 1 crédit.
    const soldeAvant = await me(id);
    expect(soldeAvant.credits.total_usable).toBe(1);

    const results = await Promise.all([
      authorize(id, "ad-test3-course-a"),
      authorize(id, "ad-test3-course-b"),
      authorize(id, "ad-test3-course-c"),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 402, 402]);
    // Exactement un crédit débité : solde final 0.
    const soldeApres = await me(id);
    expect(soldeApres.credits.total_usable).toBe(0);
  });
});
