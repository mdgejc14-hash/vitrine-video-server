// Adaptateur CinetPay — API Checkout v2 officielle.
//
// Mécanisme de VÉRIFICATION officiel (docs.cinetpay.com, « Préparez une
// page de notification ») : la notification IPN reçue sur notify_url
// (POST form cpm_*) n'est JAMAIS une preuve. Le marchand doit appeler
// lui-même POST https://api-checkout.cinetpay.com/v2/payment/check avec
// {apikey, site_id, transaction_id} et valider dans la réponse :
//   - cpm_result / code == "00" ;
//   - cpm_trans_status == "ACCEPTED" (payé) — REFUSED/CANCELLED = échec ;
//   - cpm_amount == montant enregistré côté serveur ;
//   - cpm_currency == devise enregistrée (XOF ; l'ancien libellé « CFA »
//     désigne le même Franc CFA) ;
//   - cpm_site_id == site_id configuré.
// La signature du formulaire IPN est journalisée à titre informatif mais
// l'authenticité repose sur l'appel /check initié par CE serveur avec
// l'apikey secrète (aucune clé partagée de vérification de signature
// n'est spécifiée par la documentation officielle).
//
// CINETPAY_API_BASE (var, défaut officiel) permet de pointer les tests
// E2E vers un double HTTP local clairement identifié comme simulation.

export const CINETPAY_API_BASE_DEFAULT = "https://api-checkout.cinetpay.com";

export interface InitPaymentParams {
  transactionId: string; // notre merchant_transaction_id
  amount: number; // entier XOF
  currency: "XOF";
  description: string;
  notifyUrl: string;
  returnUrl: string;
  channels?: string; // ex. "MOBILE_MONEY" — uniquement les valeurs
  // réellement prises en charge par l'intégration configurée
  lang?: "fr" | "en";
  metadata?: string;
}

export interface InitPaymentResult {
  paymentUrl: string;
  paymentToken: string;
}

export interface CheckResult {
  /** appel /check techniquement réussi (HTTP + JSON exploitables) */
  callable: boolean;
  /** code applicatif CinetPay ("00" = succès) */
  result: string | null;
  /** statut de la transaction : ACCEPTED / REFUSED / CANCELLED / … */
  status: string | null;
  amount: number | null;
  currency: string | null;
  siteId: string | null;
  /** identifiant de transaction fournisseur (cpm_payid) */
  providerPaymentId: string | null;
  paymentDate: string | null;
  signature: string | null;
  raw: unknown;
}

export class CinetPayError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** Statuts réellement payés selon la documentation officielle. */
export function isPaidStatus(status: string | null): boolean {
  if (status === null) return false;
  const s = status.trim().toUpperCase();
  return s === "ACCEPTED" || s === "VALIDATED" || s === "COMPLETED";
}

/** Statuts d'échec définitifs (le paiement n'aboutira pas). */
export function isDefinitiveFailure(status: string | null): boolean {
  if (status === null) return false;
  const s = status.trim().toUpperCase();
  return s === "REFUSED" || s === "CANCELLED" || s === "FAILED";
}

export class CinetPayClient {
  constructor(
    private readonly apiKey: string,
    private readonly siteId: string,
    private readonly apiBase: string = CINETPAY_API_BASE_DEFAULT,
  ) {}

  /** POST /v2/payment — génère le lien de paiement. */
  async initPayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const body = {
      apikey: this.apiKey,
      site_id: this.siteId,
      transaction_id: params.transactionId,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      notify_url: params.notifyUrl,
      return_url: params.returnUrl,
      channels: params.channels ?? "MOBILE_MONEY",
      lang: params.lang ?? "fr",
      metadata: params.metadata ?? "",
    };
    const res = await fetch(`${this.apiBase}/v2/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | { code?: string; message?: string; data?: { payment_url?: string; payment_token?: string } }
      | null;
    if (!res.ok || json === null) {
      throw new CinetPayError(`Initiation CinetPay impossible (HTTP ${res.status})`, res.status);
    }
    if (json.code !== "201" && json.code !== "00") {
      throw new CinetPayError(
        `Initiation CinetPay refusée : code ${json.code ?? "?"} — ${json.message ?? ""}`,
      );
    }
    const url = json.data?.payment_url;
    const token = json.data?.payment_token;
    if (typeof url !== "string" || typeof token !== "string") {
      throw new CinetPayError("Réponse CinetPay sans payment_url/payment_token.");
    }
    return { paymentUrl: url, paymentToken: token };
  }

  /** POST /v2/payment/check — vérification officielle d'une transaction. */
  async checkPayment(transactionId: string): Promise<CheckResult> {
    let httpStatus = 0;
    try {
      const res = await fetch(`${this.apiBase}/v2/payment/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apikey: this.apiKey,
          site_id: this.siteId,
          transaction_id: transactionId,
        }),
      });
      httpStatus = res.status;
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (json === null) {
        return emptyCheck(httpStatus, null);
      }
      // La réponse existe en deux formes selon la version : champs plats
      // (cpm_*) ou enveloppe {code, message, data:{…}}. Extraction
      // défensive des deux.
      const data = (json.data ?? json) as Record<string, unknown>;
      return {
        callable: true,
        result: asString(json.code) ?? asString(data.cpm_result),
        status:
          asString(data.status) ?? asString(data.cpm_trans_status),
        amount: asNumber(data.amount) ?? asNumber(data.cpm_amount),
        currency: asString(data.currency) ?? asString(data.cpm_currency),
        siteId: asString(data.cpm_site_id) ?? asString(data.site_id),
        providerPaymentId:
          asString(data.payment_id) ??
          asString(data.cpm_payid) ??
          asString(data.operator_id),
        paymentDate:
          asString(data.payment_date) ?? asString(data.cpm_payment_date),
        signature: asString(data.signature),
        raw: json,
      };
    } catch (err) {
      return emptyCheck(httpStatus, err instanceof Error ? err.message : "network error");
    }
  }
}

function emptyCheck(httpStatus: number, err: string | null): CheckResult {
  return {
    callable: false,
    result: null,
    status: null,
    amount: null,
    currency: null,
    siteId: null,
    providerPaymentId: null,
    paymentDate: null,
    signature: null,
    raw: { error: err ?? "unavailable", httpStatus },
  };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
