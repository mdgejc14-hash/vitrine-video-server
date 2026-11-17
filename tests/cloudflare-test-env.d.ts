/* eslint-disable @typescript-eslint/no-empty-object-type --
   interface vide EXTENDANT Env : motif officiel requis par
   @cloudflare/vitest-pool-workers pour typer les bindings de test. */
// Extensions de typage du module virtuel "cloudflare:test" :
// - ProvidedEnv étend l'interface Env du worker (bindings de test typés) ;
// - `migrations` est injecté au runtime par poolOptions.workers.migrations
//   (readD1Migrations dans vitest.config.ts) mais n'est pas déclaré par
//   @cloudflare/vitest-pool-workers 0.8.x — déclaration manuelle.

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
  export const migrations: Array<{ name: string; queries: string[] }>;
}
