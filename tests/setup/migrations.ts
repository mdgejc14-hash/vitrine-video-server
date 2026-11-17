// Setup global des tests :
//  1. applique les migrations D1 du dépôt (une fois par worker) ;
//  2. avant CHAQUE fichier de test, nettoie toutes les tables métier
//     (isolatedStorage est désactivé pour supporter les bancs volumineux :
//     90/200 exports consécutifs — voir vitest.config.ts).
// Les fichiers de test sont donc indépendants les uns des autres.

import { beforeAll } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";

const raw = (env as unknown as Record<string, unknown>).TEST_MIGRATIONS;
const migrations = JSON.parse(typeof raw === "string" ? raw : "[]") as Array<{
  name: string;
  queries: string[];
}>;

await applyD1Migrations(env.DB, migrations);

const TABLES = [
  "device_events",
  "payment_webhook_events",
  "export_authorizations",
  "credit_grants",
  "payments",
  "terminals",
  "rate_limit_counters",
] as const;

beforeAll(async () => {
  await env.DB.batch(
    TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
}, 10000);
