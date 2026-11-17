import { describe, expect, it } from "vitest";
import {
  computeDeviceHash,
  normalizeAndroidId,
} from "../../src/security/hmac";

const SECRET = "test-hmac-secret-0123456789abcdef0123456789abcdef";

describe("pseudonymisation des terminaux (HMAC)", () => {
  it("normalise : trim + minuscules, sans mutation de la valeur", () => {
    expect(normalizeAndroidId("  ABCDEF0123456789 ")).toBe("abcdef0123456789");
    expect(normalizeAndroidId("abcdef0123456789")).toBe("abcdef0123456789");
  });

  it("rejette les formats invalides", () => {
    expect(normalizeAndroidId("")).toBeNull();
    expect(normalizeAndroidId("abc")).toBeNull(); // trop court
    expect(normalizeAndroidId("xyz12345")).toBeNull(); // non hexa
    expect(normalizeAndroidId("z".repeat(65))).toBeNull(); // trop long
    expect(normalizeAndroidId("12345678")).not.toBeNull(); // 8 hex = valide
  });

  it("produit un HMAC-SHA256 hexadécimal de 64 caractères, déterministe", async () => {
    const a = await computeDeviceHash(SECRET, "abcdef0123456789");
    const b = await computeDeviceHash(SECRET, "abcdef0123456789");
    expect(a.deviceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.deviceHash).toBe(b.deviceHash);
    expect(a.hashKeyVersion).toBe(1);
  });

  it("deux ANDROID_ID différents donnent deux hash différents", async () => {
    const a = await computeDeviceHash(SECRET, "abcdef0123456789");
    const b = await computeDeviceHash(SECRET, "abcdef0123456790");
    expect(a.deviceHash).not.toBe(b.deviceHash);
  });

  it("un secret différent donne un hash différent (rotation possible)", async () => {
    const a = await computeDeviceHash(SECRET, "abcdef0123456789");
    const b = await computeDeviceHash("autre-secret-tres-different-0000", "abcdef0123456789");
    expect(a.deviceHash).not.toBe(b.deviceHash);
  });
});
