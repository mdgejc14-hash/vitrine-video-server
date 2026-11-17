import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

// Tests exécutés dans le VRAI runtime workerd (pas des mocks Node) avec une
// D1 SQLite réelle (miniflare). Le worker testé (SELF) est configuré par
// wrangler.test.jsonc : vars de staging + constantes de test (aucune vraie
// valeur secrète).
//
// isolatedStorage: false — les bancs officiels de la mission exécutent des
// VOLUMES élevés (90/200 exports consécutifs) qui font déborder le journal
// d'annulation du storage isolé. À la place, un nettoyage explicite entre
// fichiers de test (beforeAll global dans tests/setup/migrations.ts) garantit
// l'indépendance des suites ; singleWorker séquentialise les fichiers.

export default defineWorkersConfig(async () => {
  const dir = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(new URL(import.meta.url).pathname);
  const migrations = await readD1Migrations(path.resolve(dir, "migrations"));

  return {
    test: {
      setupFiles: ["./tests/setup/migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          isolatedStorage: false,
          wrangler: { configPath: "./wrangler.test.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: JSON.stringify(migrations),
            },
          },
        },
      },
    },
  };
});
