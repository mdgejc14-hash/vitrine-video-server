import { describe, expect, it } from "vitest";
import { PLANS, findPlan, isPaidPass, publicPlan } from "../../src/catalog/plans";

describe("catalogue commercial officiel", () => {
  it("contient exactement les quatre formules officielles", () => {
    expect(PLANS.map((p) => p.code)).toEqual([
      "FREE_INSTALL",
      "PASS_EXPRESS",
      "PASS_PRO",
      "PASS_BOUTIQUE",
    ]);
  });

  it("Test 6/8/10 — montants, crédits et durées exacts", () => {
    const express = findPlan("PASS_EXPRESS")!;
    const pro = findPlan("PASS_PRO")!;
    const boutique = findPlan("PASS_BOUTIQUE")!;
    const free = findPlan("FREE_INSTALL")!;

    expect(free.price_xof).toBe(0);
    expect(free.credits).toBe(3);
    expect(free.duration_s).toBeNull(); // sans expiration

    expect(express.price_xof).toBe(500);
    expect(express.credits).toBe(6);
    expect(express.duration_s).toBe(86_400); // 24 h exactement

    expect(pro.price_xof).toBe(3_000);
    expect(pro.credits).toBe(90);
    expect(pro.duration_s).toBe(2_592_000); // 30 jours exacts

    expect(boutique.price_xof).toBe(7_500);
    expect(boutique.credits).toBe(200);
    expect(boutique.duration_s).toBe(2_592_000); // 30 jours exacts
  });

  it("seuls les trois pass sont des produits payants", () => {
    expect(isPaidPass("PASS_EXPRESS")).toBe(true);
    expect(isPaidPass("PASS_PRO")).toBe(true);
    expect(isPaidPass("PASS_BOUTIQUE")).toBe(true);
    expect(isPaidPass("FREE_INSTALL")).toBe(false); // non achetable
    expect(isPaidPass("PASS_INEXISTANT")).toBe(false);
    expect(isPaidPass("")).toBe(false);
  });

  it("publicPlan n'expose aucune donnée interne", () => {
    const p = publicPlan(findPlan("PASS_PRO")!);
    expect(p).toEqual({
      code: "PASS_PRO",
      label: "Pass Pro",
      kind: "pass",
      price_xof: 3000,
      currency: "XOF",
      credits: 90,
      duration_s: 2592000,
    });
  });
});
