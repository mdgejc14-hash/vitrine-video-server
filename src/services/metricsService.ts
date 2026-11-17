// Service métier : statistiques administratives agrégées.
// AUCUNE donnée individuelle : pas d'ANDROID_ID, pas de hash de terminal,
// pas de secret, pas de données sensibles de paiement, pas de numéros
// WhatsApp (le backend n'en stocke de toute façon jamais).

import { toIso, Clock } from "../clock/clock";

export interface AdminMetrics {
  generated_at: string;
  terminals: {
    initialized: number;
    active_last_30d: number;
  };
  credits: {
    free_granted_total: number;
    exports_authorized: number;
    credits_consumed_total: number;
  };
  payments: {
    pending: number;
    confirmed: number;
    failed: number;
    cancelled: number;
  };
  sales: {
    PASS_EXPRESS: number;
    PASS_PRO: number;
    PASS_BOUTIQUE: number;
  };
  revenue: {
    confirmed_xof: number;
    currency: "XOF";
  };
}

export class MetricsService {
  constructor(
    private db: D1Database,
    private clock: Clock,
  ) {}

  async compute(): Promise<AdminMetrics> {
    const since30d = toIso(new Date(this.clock.now().getTime() - 30 * 86_400_000));

    const [terminals, activeTerminals, freeGrants, exports, consumed, payStatus, sales, revenue] =
      await Promise.all([
        this.db.prepare("SELECT COUNT(*) AS n FROM terminals").first<{ n: number }>(),
        this.db
          .prepare("SELECT COUNT(*) AS n FROM terminals WHERE last_seen_at >= ?1")
          .bind(since30d)
          .first<{ n: number }>(),
        this.db
          .prepare(
            `SELECT COALESCE(SUM(credits_total), 0) AS n FROM credit_grants
              WHERE grant_type = 'free_install'`,
          )
          .first<{ n: number }>(),
        this.db
          .prepare("SELECT COUNT(*) AS n FROM export_authorizations")
          .first<{ n: number }>(),
        this.db
          .prepare(
            `SELECT COALESCE(SUM(credits_total - credits_remaining), 0) AS n FROM credit_grants`,
          )
          .first<{ n: number }>(),
        this.db
          .prepare(
            `SELECT payment_status AS s, COUNT(*) AS n FROM payments GROUP BY payment_status`,
          )
          .all<{ s: string; n: number }>(),
        this.db
          .prepare(
            `SELECT product_code AS p, COUNT(*) AS n FROM payments
              WHERE payment_status = 'PAID' GROUP BY product_code`,
          )
          .all<{ p: string; n: number }>(),
        this.db
          .prepare(
            `SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE payment_status = 'PAID'`,
          )
          .first<{ n: number }>(),
      ]);

    const byStatus = Object.fromEntries((payStatus.results ?? []).map((r) => [r.s, r.n]));
    const byProduct = Object.fromEntries((sales.results ?? []).map((r) => [r.p, r.n]));

    return {
      generated_at: toIso(this.clock.now()),
      terminals: {
        initialized: terminals?.n ?? 0,
        active_last_30d: activeTerminals?.n ?? 0,
      },
      credits: {
        free_granted_total: freeGrants?.n ?? 0,
        exports_authorized: exports?.n ?? 0,
        credits_consumed_total: consumed?.n ?? 0,
      },
      payments: {
        pending: byStatus["PENDING"] ?? 0,
        confirmed: byStatus["PAID"] ?? 0,
        failed: byStatus["FAILED"] ?? 0,
        cancelled: byStatus["CANCELLED"] ?? 0,
      },
      sales: {
        PASS_EXPRESS: byProduct["PASS_EXPRESS"] ?? 0,
        PASS_PRO: byProduct["PASS_PRO"] ?? 0,
        PASS_BOUTIQUE: byProduct["PASS_BOUTIQUE"] ?? 0,
      },
      revenue: { confirmed_xof: revenue?.n ?? 0, currency: "XOF" },
    };
  }
}
