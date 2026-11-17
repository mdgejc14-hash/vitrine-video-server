// Types d'environnement du Worker Vitrine Video Lite (déclarations GLOBALES).
// Les secrets (DEVICE_ID_HMAC_SECRET, ADMIN_METRICS_TOKEN, SIMULATION_SECRET,
// CINETPAY_*) sont posés via `wrangler secret put` (ou .dev.vars en local)
// et ne figurent JAMAIS dans le dépôt.

interface Env {
  // Binding D1 (staging: vitrine-video-lite-staging-db ; production:
  // vitrine-video-lite-production-db — voir wrangler.jsonc).
  DB: D1Database;

  // Vars (non secrètes)
  ENVIRONMENT: "staging" | "production";
  PAYMENT_MODE: "simulation" | "disabled" | "real";
  CINETPAY_ENABLED: string; // "true" uniquement quand les clés réelles sont posées
  CINETPAY_ENV?: string; // "test" | "production"
  // Base API fournisseur (défaut officiel ; surchargeable UNIQUEMENT pour
  // les bancs E2E avec un double local clairement identifié comme simulation).
  CINETPAY_API_BASE?: string;
  CINETPAY_NOTIFY_URL?: string;
  CINETPAY_RETURN_URL?: string;
  API_VERSION: string;

  // Secrets applicatifs
  DEVICE_ID_HMAC_SECRET?: string;
  ADMIN_METRICS_TOKEN?: string;
  SIMULATION_SECRET?: string; // staging uniquement

  // Secrets CinetPay (non configurés à ce jour)
  CINETPAY_API_KEY?: string;
  CINETPAY_SITE_ID?: string;
  CINETPAY_SECRET_KEY?: string;
}
