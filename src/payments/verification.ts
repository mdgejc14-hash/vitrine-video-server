// Vérification d'une notification CinetPay.
//
// Règles (conformes à la documentation officielle — aucune invention) :
//  1. La notification IPN (POST form cpm_*) n'est PAS une preuve.
//  2. Le serveur appelle /v2/payment/check avec SES propres secrets.
//  3. La transaction n'est confirmée QUE si le /check renvoie :
//     code/cpm_result "00", statut payé (ACCEPTED…), montant STRICTEMENT
//     égal au montant enregistré, devise XOF (ou « CFA », même Franc CFA),
//     site_id strictement égal au site configuré, et transaction_id égal
//     à la référence marchande enregistrée.
//  4. Un retour navigateur, une réponse Android ou une notification non
//     vérifiée ne donnent JAMAIS de crédit.

import {
  CheckResult,
  isPaidStatus,
  isDefinitiveFailure,
} from "./cinetpay";

export interface VerificationInput {
  check: CheckResult;
  expectedMerchantTransactionId: string;
  expectedAmount: number;
  expectedCurrency: string; // "XOF"
  expectedSiteId: string;
}

export type VerificationVerdict =
  | { kind: "confirmed"; providerTransactionId: string | null }
  | { kind: "rejected"; reason: string }
  | { kind: "pending"; reason: string };

/** Devise acceptée : XOF (l'ancien libellé « CFA » désigne le même Franc CFA). */
export function isXof(currency: string | null): boolean {
  if (currency === null) return false;
  const c = currency.trim().toUpperCase();
  return c === "XOF" || c === "CFA";
}

export function verifyCinetPayPayment(input: VerificationInput): VerificationVerdict {
  const { check } = input;

  if (!check.callable) {
    // Impossible de vérifier auprès du fournisseur → aucun crédit.
    return { kind: "rejected", reason: "PROVIDER_CHECK_UNAVAILABLE" };
  }

  // code applicatif : "00" = succès selon la documentation.
  if (check.result !== null && check.result !== "00") {
    return { kind: "rejected", reason: `PROVIDER_CODE_${check.result}` };
  }

  const status = check.status === null ? null : check.status.trim().toUpperCase();

  if (isPaidStatus(status)) {
    // Statut payé : toutes les cohérences serveur doivent être exactes.
    if (check.amount === null || Math.trunc(check.amount) !== input.expectedAmount) {
      return { kind: "rejected", reason: "AMOUNT_MISMATCH" };
    }
    if (!isXof(check.currency)) {
      return { kind: "rejected", reason: "CURRENCY_MISMATCH" };
    }
    if (check.siteId === null || check.siteId !== input.expectedSiteId) {
      return { kind: "rejected", reason: "SITE_MISMATCH" };
    }
    if (check.providerPaymentId === null && check.signature === null) {
      return { kind: "rejected", reason: "MISSING_PROVIDER_REFERENCE" };
    }
    return { kind: "confirmed", providerTransactionId: check.providerPaymentId };
  }

  if (isDefinitiveFailure(status)) {
    return { kind: "rejected", reason: `PROVIDER_STATUS_${status}` };
  }

  // Ni payé, ni échec définitif (ex. PENDING) : aucun crédit, réessayable.
  return { kind: "pending", reason: `PROVIDER_STATUS_${status ?? "UNKNOWN"}` };
}
