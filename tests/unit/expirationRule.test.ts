import { describe, expect, it } from "vitest";
import { FixedClock, isExpired, toIso } from "../../src/clock/clock";

// La règle officielle : un lot est valide si now < expires_at.
// À l'instant exact now == expires_at, il est expiré.

describe("règle d'expiration (now < expires_at)", () => {
  const T0 = new Date("2026-11-17T10:00:00.000Z");

  it("Test 7 — Pass Express : actif à 23:59:59, expiré à 24:00:00", () => {
    const expires = toIso(new Date(T0.getTime() + 86_400_000));
    const at23h59m59s = new FixedClock(new Date(T0.getTime() + 86_399_000));
    const at24h00m00s = new FixedClock(new Date(T0.getTime() + 86_400_000));
    expect(isExpired(expires, at23h59m59s.now())).toBe(false);
    expect(isExpired(expires, at24h00m00s.now())).toBe(true);
  });

  it("Test 9/11 — Pass Pro/Boutique : actifs à 29 j 23:59:59, expirés à 30 j", () => {
    const expires = toIso(new Date(T0.getTime() + 2_592_000_000));
    const avant = new FixedClock(new Date(T0.getTime() + 2_591_999_000));
    const exact = new FixedClock(new Date(T0.getTime() + 2_592_000_000));
    expect(isExpired(expires, avant.now())).toBe(false);
    expect(isExpired(expires, exact.now())).toBe(true);
  });

  it("un lot sans expiration (crédits gratuits) n'expire jamais", () => {
    expect(isExpired(null, new Date("2099-01-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("horodatage canonique", () => {
  it("toIso produit un format comparable lexicalement (ms fixes)", () => {
    expect(toIso(new Date("2026-11-17T10:00:00.123Z"))).toBe("2026-11-17T10:00:00.123Z");
    expect("2026-11-17T10:00:00.123Z" < "2026-11-17T10:00:00.124Z").toBe(true);
  });
});
