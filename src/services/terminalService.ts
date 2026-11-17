// Service métier : terminaux (bootstrap, identification).
//
// Bootstrap — exigences mission :
//  - exactement 3 crédits gratuits, UNE SEULE fois, sans expiration ;
//  - terminal connu → solde conservé, last_seen_at actualisé ;
//  - opérations atomiques (batch D1 transactionnel) ;
//  - deux bootstraps simultanés ne doublent jamais l'attribution
//    (UNIQUE(device_hash) : le perdant roule sur la lecture de l'existant).

import { toIso, Clock } from "../clock/clock";
import { computeDeviceHash } from "../security/hmac";
import { ApiError } from "../security/errors";
import { PLANS } from "../catalog/plans";
import {
  findByDeviceHash,
  isUniqueViolation,
  TerminalRow,
} from "../repositories/terminals";

export interface BootstrapInput {
  androidId: string;
  appVersion?: string;
  platform?: string;
}

export interface BootstrapResult {
  terminal: TerminalRow;
  created: boolean;
}

function uuid(): string {
  return crypto.randomUUID();
}

export class TerminalService {
  constructor(
    private db: D1Database,
    private clock: Clock,
    private hmacSecret: string,
  ) {}

  /** Identifie un terminal existant depuis l'ANDROID_ID (header). */
  async identify(androidId: string): Promise<TerminalRow> {
    const { deviceHash } = await computeDeviceHash(this.hmacSecret, androidId);
    const terminal = await findByDeviceHash(this.db, deviceHash);
    if (terminal === null) {
      throw new ApiError(
        "TERMINAL_NOT_FOUND",
        "Terminal inconnu — appelle POST /v1/terminals/bootstrap d'abord.",
      );
    }
    return terminal;
  }

  async bootstrap(input: BootstrapInput): Promise<BootstrapResult> {
    const now = toIso(this.clock.now());
    const { deviceHash, hashKeyVersion } = await computeDeviceHash(
      this.hmacSecret,
      input.androidId,
    );

    const existing = await findByDeviceHash(this.db, deviceHash);
    if (existing !== null) {
      // Terminal connu : AUCUNE réattribution de crédits gratuits.
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE terminals
                SET last_seen_at = ?2,
                    app_version = COALESCE(?3, app_version),
                    platform = COALESCE(?4, platform),
                    updated_at = ?2
              WHERE id = ?1`,
          )
          .bind(existing.id, now, input.appVersion ?? null, input.platform ?? null),
        this.db
          .prepare(
            `INSERT INTO device_events (id, terminal_id, event_type, occurred_at, metadata)
             VALUES (?1, ?2, 'terminal_seen', ?3, ?4)`,
          )
          .bind(uuid(), existing.id, now, JSON.stringify({ source: "bootstrap" })),
      ]);
      return { terminal: existing, created: false };
    }

    // Nouveau terminal : insertion + attribution gratuite, atomiques.
    const terminalId = uuid();
    const free = PLANS.find((p) => p.code === "FREE_INSTALL")!;
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO terminals
               (id, device_hash, hash_key_version, first_seen_at, last_seen_at,
                app_version, platform, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, 'active', ?4, ?4)`,
          )
          .bind(
            terminalId, deviceHash, hashKeyVersion, now,
            input.appVersion ?? null, input.platform ?? null,
          ),
        this.db
          .prepare(
            `INSERT INTO credit_grants
               (id, terminal_id, grant_type, product_code, credits_total,
                credits_remaining, starts_at, expires_at, status, payment_id, created_at)
             VALUES (?1, ?2, 'free_install', 'FREE_INSTALL', ?3, ?3, ?4, NULL, 'active', NULL, ?4)`,
          )
          .bind(uuid(), terminalId, free.credits, now),
        this.db
          .prepare(
            `INSERT INTO device_events (id, terminal_id, event_type, occurred_at, metadata)
             VALUES (?1, ?2, 'terminal_created', ?3, ?4)`,
          )
          .bind(uuid(), terminalId, now, JSON.stringify({ credits: free.credits })),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Bootstrap concurrent gagné par un autre appel : on relit l'état.
        const winner = await findByDeviceHash(this.db, deviceHash);
        if (winner !== null) return { terminal: winner, created: false };
      }
      throw err;
    }

    const terminal = await findByDeviceHash(this.db, deviceHash);
    if (terminal === null) {
      throw new ApiError("INTERNAL_ERROR", "Terminal illisible après création.");
    }
    return { terminal, created: true };
  }
}
