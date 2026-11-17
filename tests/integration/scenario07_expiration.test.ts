import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { FixedClock, toIso } from "../../src/clock/clock";
import { CreditService } from "../../src/services/creditService";
import { ExportService } from "../../src/services/exportService";
import { TerminalService } from "../../src/services/terminalService";
import { PaymentService } from "../../src/services/paymentService";
import { bootstrap, authorize, me, buyPass, androidId, db } from "./helpers";

const TEST_HMAC_SECRET = "test-hmac-secret-0123456789abcdef0123456789abcdef";

// Tests 7, 9 et 11 — expirations EXACTES.
// Méthode 1 (service + FixedClock) : l'horloge métier est avancée à la
// milliseconde près autour de expires_at — la règle officielle
// `now < expires_at` est vérifiée sans modifier l'horloge réelle.
// Méthode 2 (HTTP + « voyage temporel ») : le lot est ajusté en base
// (technique de test standard : déplacer expires_at équivaut exactement au
// passage du temps), puis le comportement est observé par HTTP réel.

const T0 = new Date("2026-11-17T12:00:00.000Z");

async function setupExpiredTerminal(clock: FixedClock): Promise<{
  terminalId: string;
  androidId: string;
}> {
  const svc = new TerminalService(env.DB, clock, TEST_HMAC_SECRET);
  const androidIdStr = androidId(`exp-${Math.random().toString(36).slice(2, 8)}`);
  const { terminal } = await svc.bootstrap({ androidId: androidIdStr });
  return { terminalId: terminal.id, androidId: androidIdStr };
}

async function buyPassAt(
  androidIdStr: string,
  productCode: string,
  clock: FixedClock,
): Promise<void> {
  const terminalSvc = new TerminalService(env.DB, clock, TEST_HMAC_SECRET);
  const terminal = await terminalSvc.identify(androidIdStr);
  const paymentSvc = new PaymentService(env.DB, clock, {
    paymentMode: "simulation",
    cinetpayEnabled: "false",
  });
  const init = await paymentSvc.initiate(terminal.id, productCode);
  const outcome = await paymentSvc.settleFromProvider({
    source: "simulation",
    merchantTransactionId: init.payment.merchant_transaction_id,
    eventReference: `SIM-${init.payment.merchant_transaction_id}-success`,
    simulatedOutcome: "success",
  });
  if (!outcome.credited) throw new Error("settle échoué en préparation");
}

async function balanceAt(terminalId: string, clock: FixedClock) {
  return new CreditService(env.DB, clock).getBalance(terminalId);
}

describe("Test 7 — expiration Pass Express (24 h exactement)", () => {
  it("à 23:59:59 le lot est actif ; à 24:00:00 il est expiré (now < expires_at)", async () => {
    const clock = new FixedClock(T0);
    const { terminalId, androidId: id } = await setupExpiredTerminal(clock);
    await buyPassAt(id, "PASS_EXPRESS", clock);

    const lot = await db()
      .prepare(
        "SELECT starts_at, expires_at FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'",
      )
      .bind(terminalId)
      .first<{ starts_at: string; expires_at: string }>();
    expect(lot).not.toBeNull();
    // expires_at = starts_at + 86 400 s exactement.
    expect(Date.parse(lot!.expires_at) - Date.parse(lot!.starts_at)).toBe(86_400_000);

    clock.set(new Date(Date.parse(lot!.expires_at) - 1)); // 23:59:59.999
    const avant = await balanceAt(terminalId, clock);
    expect(avant.paid_remaining).toBe(6);
    expect(avant.grants.find((g) => g.type === "pass")!.status).toBe("active");

    clock.set(new Date(Date.parse(lot!.expires_at))); // 24:00:00.000 pile
    const apres = await balanceAt(terminalId, clock);
    expect(apres.paid_remaining).toBe(0); // exclu du solde
    expect(apres.grants.find((g) => g.type === "pass")!.status).toBe("expired");
    // Les crédits gratuits non expirables restent utilisables.
    expect(apres.free_remaining).toBe(3);

    // Les crédits expirés ne sont jamais réactivés : l'export revient aux gratuits.
    const exportSvc = new ExportService(env.DB, clock);
    const r = await exportSvc.authorize(terminalId, "ad-exp-express-1");
    expect(r.replay).toBe(false);
    expect(r.credits_after.free_remaining).toBe(2); // débit sur les gratuits
    expect(r.credits_after.paid_remaining).toBe(0);
  });
});

describe("Test 9 — expiration Pass Pro (30 jours exactement)", () => {
  it("à 29 j 23:59:59 actif ; à 30 jours exacts expiré", async () => {
    const clock = new FixedClock(T0);
    const { terminalId, androidId: id } = await setupExpiredTerminal(clock);
    await buyPassAt(id, "PASS_PRO", clock);

    const lot = await db()
      .prepare(
        "SELECT starts_at, expires_at FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'",
      )
      .bind(terminalId)
      .first<{ starts_at: string; expires_at: string }>();
    expect(Date.parse(lot!.expires_at) - Date.parse(lot!.starts_at)).toBe(2_592_000_000);

    clock.set(new Date(Date.parse(lot!.expires_at) - 1_000)); // 29 j 23:59:59
    expect((await balanceAt(terminalId, clock)).paid_remaining).toBe(90);
    clock.set(new Date(Date.parse(lot!.expires_at))); // 30 jours pile
    expect((await balanceAt(terminalId, clock)).paid_remaining).toBe(0);
  });
});

describe("Test 11 — expiration Pass Boutique (30 jours exactement)", () => {
  it("à 29 j 23:59:59 actif ; à 30 jours exacts expiré", async () => {
    const clock = new FixedClock(T0);
    const { terminalId, androidId: id } = await setupExpiredTerminal(clock);
    await buyPassAt(id, "PASS_BOUTIQUE", clock);

    const lot = await db()
      .prepare(
        "SELECT starts_at, expires_at FROM credit_grants WHERE terminal_id = ?1 AND grant_type = 'pass'",
      )
      .bind(terminalId)
      .first<{ starts_at: string; expires_at: string }>();
    expect(Date.parse(lot!.expires_at) - Date.parse(lot!.starts_at)).toBe(2_592_000_000);

    clock.set(new Date(Date.parse(lot!.expires_at) - 1_000));
    expect((await balanceAt(terminalId, clock)).paid_remaining).toBe(200);
    clock.set(new Date(Date.parse(lot!.expires_at)));
    expect((await balanceAt(terminalId, clock)).paid_remaining).toBe(0);
  });
});

describe("expiration observée par HTTP réel (voyage temporel en base)", () => {
  it("un lot passé est exclu du solde et des exports HTTP", async () => {
    const id = androidId("exp-http");
    await bootstrap(id);
    await buyPass(id, "PASS_EXPRESS");

    // Voyage temporel : expires_at déplacé dans le passé (équivalent exact
    // du passage du temps — le serveur compare toujours now < expires_at).
    await db()
      .prepare(
        `UPDATE credit_grants
            SET expires_at = ?1
          WHERE terminal_id = (SELECT id FROM terminals WHERE id = ?2)
            AND grant_type = 'pass'`,
      )
      .bind(toIso(new Date(Date.now() - 1000)), (await me(id)).terminal.id)
      .run();

    const solde = await me(id);
    expect(solde.credits.paid_remaining).toBe(0);
    expect(solde.credits.free_remaining).toBe(3); // gratuits non expirables
    expect(solde.grants.find((g: any) => g.type === "pass").status).toBe("expired");

    // L'export HTTP débite les gratuits (payant expiré).
    const r = await authorize(id, "ad-exp-http-1");
    expect(r.status).toBe(201);
    expect(r.body.credits.free_remaining).toBe(2);
  });
});
