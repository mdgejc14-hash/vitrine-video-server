// Pseudonymisation des terminaux.
//
// device_hash = HMAC-SHA256(DEVICE_ID_HMAC_SECRET, "v1:" + android_id_normalisé)
//
// - L'ANDROID_ID brut n'est JAMAIS stocké en D1, ni journalisé, ni retourné.
// - La normalisation (trim + minuscules) garantit un hash stable pour une
//   même valeur émise avec une casse/espacement différent.
// - hash_key_version permet de faire tourner la clé secrète plus tard sans
//   perdre l'historique (v1 aujourd'hui).
// - HONNÊTETÉ (exigée par la mission) : le HMAC pseudonymise le stockage,
//   il ne constitue NI une preuve matérielle inviolable, NI une protection
//   absolue contre l'usurpation d'identité (l'ANDROID_ID peut changer après
//   une réinitialisation d'usine et dépend de l'identité de signature de
//   l'app). L'architecture reste extensible à Play Integrity sans que cette
//   intégration soit obligatoire.

const HASH_KEY_VERSION = 1;

export interface DeviceHashResult {
  deviceHash: string;
  hashKeyVersion: number;
}

/** Validation du format transmis : hexadécimal 8..64 caractères. */
export function normalizeAndroidId(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{8,64}$/.test(v)) return null;
  return v;
}

async function hmacSha256(secret: string, message: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, enc.encode(message));
}

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Calcule le hash pseudonyme d'un ANDROID_ID déjà normalisé. */
export async function computeDeviceHash(
  secret: string,
  normalizedAndroidId: string,
): Promise<DeviceHashResult> {
  const mac = await hmacSha256(secret, `v${HASH_KEY_VERSION}:${normalizedAndroidId}`);
  return { deviceHash: toHex(mac), hashKeyVersion: HASH_KEY_VERSION };
}
