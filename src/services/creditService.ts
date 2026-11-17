// Service métier : soldes et lots de crédits.
//
// Règles mission :
//  - le solde EXCLUT les lots expirés (now < expires_at, UTC Worker) ;
//  - lots payants représentés séparément (chaque achat = lot indépendant) ;
//  - ordre de consommation : payant valide expirant le plus tôt d'abord,
//    crédits gratuits préservés tant qu'un lot payant valide a des crédits
//    (implémenté par le tri SQL du débit atomique, cf. repositories/grants).

import { toIso, isExpired, Clock } from "../clock/clock";
import { CreditGrantRow, listByTerminal } from "../repositories/grants";

export interface GrantView {
  id: string;
  type: "free_install" | "pass";
  product_code: string;
  credits_total: number;
  credits_remaining: number;
  starts_at: string;
  expires_at: string | null;
  /** statut dérivé de l'horloge : active | expired | exhausted */
  status: "active" | "expired" | "exhausted";
}

export interface Balance {
  total_usable: number;
  free_remaining: number;
  paid_remaining: number;
  can_export: boolean;
  grants: GrantView[];
  active_passes: GrantView[];
}

export class CreditService {
  constructor(
    private db: D1Database,
    private clock: Clock,
  ) {}

  async getBalance(terminalId: string): Promise<Balance> {
    const now = this.clock.now();
    const rows = await listByTerminal(this.db, terminalId);

    const grants: GrantView[] = rows.map((r) => deriveGrantView(r, now));
    const usable = grants.filter(
      (g) => g.status === "active" && g.credits_remaining > 0,
    );
    const freeRemaining = usable
      .filter((g) => g.type === "free_install")
      .reduce((s, g) => s + g.credits_remaining, 0);
    const paidRemaining = usable
      .filter((g) => g.type === "pass")
      .reduce((s, g) => s + g.credits_remaining, 0);

    return {
      total_usable: freeRemaining + paidRemaining,
      free_remaining: freeRemaining,
      paid_remaining: paidRemaining,
      can_export: freeRemaining + paidRemaining > 0,
      grants,
      active_passes: usable.filter((g) => g.type === "pass"),
    };
  }
}

export function deriveGrantView(r: CreditGrantRow, now: Date): GrantView {
  let status: GrantView["status"];
  if (r.status === "revoked") {
    status = "expired"; // vue conservatrice ; le statut stocké reste distinct
  } else if (isExpired(r.expires_at, now)) {
    status = "expired"; // now >= expires_at → expiré, non réactivable
  } else if (r.credits_remaining === 0) {
    status = "exhausted";
  } else {
    status = "active";
  }
  return {
    id: r.id,
    type: r.grant_type,
    product_code: r.product_code,
    credits_total: r.credits_total,
    credits_remaining: r.credits_remaining,
    starts_at: r.starts_at,
    expires_at: r.expires_at,
    status,
  };
}

export { toIso };
