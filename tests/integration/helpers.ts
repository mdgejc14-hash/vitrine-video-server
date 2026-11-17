// Helpers d'intégration : tous les appels passent par le VRAI routeur HTTP
// du worker (SELF.fetch) — mêmes chemins, mêmes en-têtes que la future
// application Android.

import { SELF, env } from "cloudflare:test";

export const SIM_SECRET = "test-simulation-secret-0123456789abcdef";
export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef";

export function androidId(seed: string): string {
  // ANDROID_ID réaliste : 16 caractères hexadécimaux.
  let h = "";
  for (let i = 0; i < seed.length && h.length < 16; i++) {
    h += (seed.charCodeAt(i) % 16).toString(16);
  }
  while (h.length < 16) h += "0";
  return h.slice(0, 16);
}

export async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function postForm(
  path: string,
  formBody: string,
): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody,
  });
}

export async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, { headers });
}

export function device(id: string): Record<string, string> {
  return { "x-device-id": id };
}

export async function bootstrap(id: string): Promise<{
  status: number;
  created: boolean;
  body: Record<string, any>;
}> {
  const res = await postJson(
    "/v1/terminals/bootstrap",
    { app_version: "1.0.0-test", platform: "android" },
    device(id),
  );
  const body = (await res.json()) as Record<string, any>;
  return { status: res.status, created: body.created === true, body };
}

export async function me(id: string): Promise<Record<string, any>> {
  const res = await get("/v1/terminals/me", device(id));
  return (await res.json()) as Record<string, any>;
}

export async function authorize(
  id: string,
  idempotencyKey: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await postJson(
    "/v1/exports/authorize",
    {},
    { ...device(id), "idempotency-key": idempotencyKey },
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

export async function initiate(
  id: string,
  productCode: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await postJson(
    "/v1/payments/initiate",
    { product_code: productCode },
    device(id),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

export async function settle(
  mti: string,
  outcome: "success" | "failure",
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await postJson(
    "/__test__/payments/settle",
    { merchant_transaction_id: mti, outcome },
    { authorization: `Bearer ${SIM_SECRET}` },
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

export async function buyPass(
  id: string,
  productCode: string,
): Promise<string> {
  const init = await initiate(id, productCode);
  if (init.status !== 200) {
    throw new Error(`initiate ${productCode} → ${init.status}: ${JSON.stringify(init.body)}`);
  }
  const mti = init.body.payment.merchant_transaction_id as string;
  const done = await settle(mti, "success");
  if (done.status !== 200 || done.body.credited !== true) {
    throw new Error(`settle ${mti} → ${done.status}: ${JSON.stringify(done.body)}`);
  }
  return mti;
}

/** Accès direct à la D1 de test (vérifications bas niveau). */
export function db(): D1Database {
  return env.DB;
}
