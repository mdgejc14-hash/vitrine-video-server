// Service métier : autorisation d'export.
//
// RÈGLE ESSENTIELLE — une publicité, un crédit :
// enregistrer dans la galerie et partager sur WhatsApp sont DEUX moyens de
// diffuser UNE SEULE publicité finalisée. L'application transmet la même
// clé d'idempotence pour les deux actions : le serveur retourne
// l'autorisation initiale SANS nouveau débit. Le serveur ne reçoit jamais
// le fichier vidéo.
//
// MÉCANISME ATOMIQUE (contrainte D1 : pas de CTE « data-modifying ») :
//   1. Recherche du replay (même clé) → retour immédiat, aucun débit.
//   2. RÉSERVATION : UPDATE atomique du lot éligible (payant expirant le
//      plus tôt d'abord, gratuits en dernier) → 0 ou 1 crédit débité,
//      jamais deux (sérialisation SQLite).
//   3. INSERT de l'autorisation (UNIQUE terminal+clé).
//      - Si la clé existe déjà (course concurrente avec la même clé) :
//        COMPENSATION immédiate du débit (+1) puis retour en replay.
//        Résultat final net : exactement un débit.
//      - Si aucun lot éligible à l'étape 2 : HTTP 402, aucun débit.
// Deux demandes concurrentes sur le dernier crédit ne peuvent donc JAMAIS
// aboutir à deux débits durables.
//
// CONVERGENCE DES COURSES MÊME CLÉ (correctif 17/11) : sous concurrence,
// des requêtes jumelles peuvent consommer les crédits visibles AVANT que
// l'INSERTion du gagnant ne soit visible (séquence observée : 3 débits
// sérialisés → 0 crédit visible → 402 parasites AVANT l'insertion). Le
// chemin d'échec du débit re-vérifie donc l'existence d'une autorisation
// même clé de façon BORNÉE (5 tentatives, 25 ms) : si le gagnant insère
// entre-temps, la requête devient un replay (200) ; sinon le 402 est
// authentique. Les courses à clés DIFFÉRENTES ne convergent jamais :
// la compétition sur le dernier crédit reste 1×201 + N×402.

import { toIso, Clock } from "../clock/clock";
import { ApiError } from "../security/errors";
import { PLANS, publicPlan } from "../catalog/plans";
import { debitOneCredit, creditBack, insertAuthorization } from "../repositories/grants";
import { findByIdempotencyKey, ExportAuthorizationRow } from "../repositories/exports";
import { recordDeviceEvent } from "../repositories/events";
import { CreditService, Balance } from "./creditService";

export interface AuthorizeResult {
  replay: boolean;
  authorization: {
    id: string;
    status: string;
    authorized_at: string;
    idempotency_key: string;
  };
  credits_after: Balance;
}

export class ExportService {
  private credits: CreditService;

  constructor(
    private db: D1Database,
    private clock: Clock,
  ) {
    this.credits = new CreditService(db, clock);
  }

  async authorize(
    terminalId: string,
    idempotencyKey: string,
  ): Promise<AuthorizeResult> {
    // 1) Replay : la même clé retrouve TOUJOURS l'autorisation initiale.
    const existing = await findByIdempotencyKey(this.db, terminalId, idempotencyKey);
    if (existing !== null) {
      return this.replayOf(terminalId, existing);
    }

    // 2) Réservation atomique d'un crédit.
    const nowIso = toIso(this.clock.now());
    const reservation = await debitOneCredit(this.db, {
      terminalId,
      nowIso,
    });

    if (reservation === null) {
      // Aucun crédit utilisable… OU course même clé : des requêtes
      // jumelles ont pu épuiser les crédits visibles juste avant que
      // l'autorisation du gagnant ne soit insérée. Re-vérification
      // BORNÉE : si elle apparaît, replay ; sinon refus authentique.
      const raced = await this.waitForRacedAuthorization(terminalId, idempotencyKey);
      if (raced !== null) {
        return this.replayOf(terminalId, raced);
      }
      // Refus authentique : offres officielles.
      throw new ApiError("INSUFFICIENT_CREDITS", "Aucun crédit utilisable.", {
        plans: PLANS.map(publicPlan),
      });
    }

    // 3) Insertion de l'autorisation ; en cas de course sur la MÊME clé,
    //    compensation du débit et retour en replay.
    const authId = crypto.randomUUID();
    const inserted = await insertAuthorization(this.db, {
      id: authId,
      terminalId,
      grantId: reservation.grantId,
      idempotencyKey,
      nowIso,
    });

    if (!inserted) {
      await creditBack(this.db, reservation.grantId);
      return this.authorize(terminalId, idempotencyKey);
    }

    await recordDeviceEvent(this.db, {
      id: crypto.randomUUID(),
      terminalId,
      eventType: "export_authorized",
      occurredAt: nowIso,
      metadata: { idempotency_key: idempotencyKey, grant_id: reservation.grantId },
    });

    const balance = await this.credits.getBalance(terminalId);
    return {
      replay: false,
      authorization: {
        id: authId,
        status: "active",
        authorized_at: nowIso,
        idempotency_key: idempotencyKey,
      },
      credits_after: balance,
    };
  }

  /** Réponse de replay (même clé) : autorisation d'origine, aucun débit. */
  private async replayOf(
    terminalId: string,
    existing: ExportAuthorizationRow,
  ): Promise<AuthorizeResult> {
    await recordDeviceEvent(this.db, {
      id: crypto.randomUUID(),
      terminalId,
      eventType: "export_replayed",
      occurredAt: toIso(this.clock.now()),
      metadata: { idempotency_key: existing.idempotency_key },
    });
    const balance = await this.credits.getBalance(terminalId);
    return {
      replay: true,
      authorization: {
        id: existing.id,
        status: existing.status,
        authorized_at: existing.authorized_at,
        idempotency_key: existing.idempotency_key,
      },
      credits_after: balance,
    };
  }

  /**
   * Convergence bornée des courses même clé : le gagnant insère son
   * autorisation quelques millisecondes après son débit ; les requêtes
   * dont le débit a échoué (0 crédit visible) re-vérifient donc un
   * nombre LIMITÉ de fois avant de conclure à un refus authentique.
   * Cinq tentatives espacées de 25 ms suffisent largement (insertion =
   * une instruction D1). Ce chemin n'existe QUE dans le cas d'échec de
   * débit : aucun coût dans le parcours nominal.
   */
  private async waitForRacedAuthorization(
    terminalId: string,
    idempotencyKey: string,
    attempts = 5,
    delayMs = 25,
  ): Promise<ExportAuthorizationRow | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const existing = await findByIdempotencyKey(this.db, terminalId, idempotencyKey);
      if (existing !== null) return existing;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }
}
