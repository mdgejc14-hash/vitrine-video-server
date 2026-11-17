import { describe, expect, it } from "vitest";
import { bootstrap, me, authorize, androidId, db, postJson } from "./helpers";

// Test 1 — Nouveau terminal : création, HMAC, 3 crédits gratuits sans
// expiration, ANDROID_ID brut absent de D1.
// Test 4 — Réinstallation : le solde est conservé, jamais réattribué.
// Test 5 — Deux terminaux indépendants.

describe("Test 1 — nouveau terminal", () => {
  it("bootstrap crée le terminal avec exactement 3 crédits gratuits sans expiration", async () => {
    const id = androidId("test1-nouveau");
    const r = await bootstrap(id);
    expect(r.status).toBe(201);
    expect(r.created).toBe(true);
    expect(r.body.credits.total_usable).toBe(3);
    expect(r.body.credits.free_remaining).toBe(3);
    expect(r.body.credits.paid_remaining).toBe(0);
    expect(r.body.free_credits_policy).toEqual({
      credits: 3,
      expires: false,
      reattributed_on_reinstall: false,
    });

    // Le lot gratuit n'a pas d'expiration (pour CE terminal).
    const termId1 = (r.body.terminal as { id: string }).id;
    const grants = await db()
      .prepare(
        "SELECT * FROM credit_grants WHERE grant_type = 'free_install' AND terminal_id = ?1",
      )
      .bind(termId1)
      .all();
    const rows = grants.results ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]!.expires_at).toBeNull();
    expect(rows[0]!.credits_total).toBe(3);
    expect(rows[0]!.product_code).toBe("FREE_INSTALL");
  });

  it("l'ANDROID_ID brut n'apparaît NULLE PART en D1 (toutes les tables)", async () => {
    const raw = androidId("test1-brutabc");
    await bootstrap(raw);
    const tables = [
      "terminals",
      "credit_grants",
      "payments",
      "export_authorizations",
      "payment_webhook_events",
      "device_events",
      "rate_limit_counters",
    ];
    for (const t of tables) {
      const rows = await db().prepare(`SELECT * FROM ${t}`).all();
      const serialized = JSON.stringify(rows.results ?? []);
      expect(serialized.includes(raw), `ANDROID_ID brut trouvé dans ${t}`).toBe(false);
    }
  });

  it("device_hash = HMAC-SHA256 hexadécimal unique, version 1, jamais la valeur brute", async () => {
    const id = androidId("test1-hmac");
    await bootstrap(id);
    const rows = await db()
      .prepare("SELECT device_hash, hash_key_version FROM terminals")
      .all<{ device_hash: string; hash_key_version: number }>();
    expect(rows.results?.length).toBeGreaterThanOrEqual(1);
    for (const r of rows.results ?? []) {
      expect(r.device_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(r.device_hash).not.toBe(id);
      expect(r.hash_key_version).toBe(1);
    }
  });
});

describe("Test 4 — réinstallation (même ANDROID_ID)", () => {
  it("3 crédits consommés → re-bootstrap → solde toujours 0, aucune réattribution", async () => {
    const id = androidId("test4-reinstall");
    const first = await bootstrap(id);
    expect(first.body.credits.total_usable).toBe(3);

    // Consommer les trois crédits gratuits.
    for (let i = 1; i <= 3; i++) {
      const r = await authorize(id, `ad-test4-${i}`);
      expect(r.status).toBe(201);
    }
    expect((await me(id)).credits.total_usable).toBe(0);

    // « Désinstallation + réinstallation » : le serveur ne voit qu'un
    // nouvel appel bootstrap avec le MÊME ANDROID_ID.
    const second = await bootstrap(id);
    expect(second.status).toBe(200); // pas 201 : pas un nouveau terminal
    expect(second.created).toBe(false);
    expect(second.body.credits.total_usable).toBe(0); // solde conservé à zéro
    expect(second.body.credits.free_remaining).toBe(0);

    // Aucun second lot gratuit créé POUR CE terminal.
    const termId = (second.body.terminal as { id: string }).id;
    const grants = await db()
      .prepare(
        "SELECT COUNT(*) AS n FROM credit_grants WHERE grant_type = 'free_install' AND terminal_id = ?1",
      )
      .bind(termId)
      .first<{ n: number }>();
    expect(grants?.n).toBe(1);
  });

  it("un re-bootstrap SANS consommation conserve le solde intact", async () => {
    const id = androidId("test4-solde");
    await bootstrap(id);
    await authorize(id, "ad-test4-solde-1");
    const again = await bootstrap(id);
    expect(again.created).toBe(false);
    expect(again.body.credits.total_usable).toBe(2); // 3 - 1 conservé
  });
});

describe("Test 5 — deux terminaux indépendants", () => {
  it("deux ANDROID_ID différents → deux terminaux, 3 crédits chacun, débits isolés", async () => {
    const a = androidId("test5-terminal-a");
    const b = androidId("test5-terminal-b");
    const ra = await bootstrap(a);
    const rb = await bootstrap(b);
    expect(ra.created).toBe(true);
    expect(rb.created).toBe(true);
    expect(ra.body.terminal.id).not.toBe(rb.body.terminal.id);
    expect(ra.body.credits.total_usable).toBe(3);
    expect(rb.body.credits.total_usable).toBe(3);

    // Consommer 1 crédit sur A ne touche pas B.
    await authorize(a, "ad-test5-a-1");
    expect((await me(a)).credits.total_usable).toBe(2);
    expect((await me(b)).credits.total_usable).toBe(3);

    const idA = (ra.body.terminal as { id: string }).id;
    const idB = (rb.body.terminal as { id: string }).id;
    const count = await db()
      .prepare("SELECT COUNT(*) AS n FROM terminals WHERE id IN (?1, ?2)")
      .bind(idA, idB)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("ANDROID_ID invalide → 400 INVALID_DEVICE_ID, aucun terminal créé", async () => {
    const res = await postJson("/v1/terminals/bootstrap", {}, { "x-device-id": "!!invalide!!" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_DEVICE_ID");
  });
});
