# BACKEND_CONTRACT.md — Contrat serveur VITRINE VIDÉO LITE

> Version 1.0.0 — 17/11/2026. Ce document fait foi pour le client Android
> et pour tout audit. Chaque comportement décrit ici est **couvert par un
> test réellement exécuté** (cf. §9 et REPORT_SERVER_FINAL.md).
> Spécification machine : `OPENAPI.yaml`.

## 1. Modèle fondamental

**1 téléphone = 1 terminal = des crédits.**

- Aucun compte utilisateur, aucun e-mail, aucun mot de passe.
- Aucun code promo, aucun parrainage, aucun ambassadeur.
- Le serveur ne stocke **ni vidéo, ni gabarit, ni asset, ni donnée du
  formulaire publicitaire** (écrans 06-07 : 100 % locaux au téléphone).
- Identification : en-tête `X-Device-Id` = ANDROID_ID (hexadécimal 8-64).
- Pseudonymisation : le serveur hash l'ANDROID_ID par
  **HMAC-SHA256(secret, "v1:" + android_id)** avant toute écriture.
  La valeur brute n'apparaît **jamais** en D1, dans les journaux, les
  réponses, les commits ni les rapports. Les réponses ne renvoient qu'un
  pseudonyme `term-xxxxxxxx` (8 premiers caractères de l'UUID terminal).

## 2. Catalogue des formules (source serveur, figée)

| Code | Libellé | Prix | Crédits | Validité |
|---|---|---|---|---|
| `FREE_INSTALL` | Découverte gratuite | 0 XOF | 3 | sans expiration |
| `PASS_EXPRESS` | Pass Express | 500 XOF | 6 | 86 400 s (24 h) |
| `PASS_PRO` | Pass Pro | 3 000 XOF | 90 | 2 592 000 s (30 j) |
| `PASS_BOUTIQUE` | Pass Boutique | 7 500 XOF | 200 | 2 592 000 s (30 j) |

Le client ne choisit **jamais** montant, crédits ni durée : tout vient de
`/v1/plans` (ou des `details.plans` d'un 402) et de l'enregistrement
serveur à l'initiation du paiement.

## 3. Règles de crédits

1. **Bootstrap** (`POST /v1/terminals/bootstrap`) : 3 crédits gratuits
   attribués **une seule fois**, atomiquement (batch D1 transactionnel).
   Réinstallation (même ANDROID_ID) → `200`, solde conservé, **aucune**
   réattribution. Deux bootstraps simultanés ne doublent jamais
   (contrainte `UNIQUE(device_hash)`) — prouvé par test.
2. **Expiration stricte** : un lot est utilisable si et seulement si
   `now < expires_at` (comparaison lexicale ISO-8601 UTC ms). Les lots
   gratuits n'expirent jamais.
3. **Consommation** : le débit prend d'abord le **lot payant valide qui
   expire le plus tôt** ; les crédits gratuits sont préservés en dernier.
4. **Une publicité = un crédit** (`rule: one_ad_one_credit`).
   Enregistrer dans la galerie puis partager sur WhatsApp = **la même
   autorisation**, obtenue avec la **même** `Idempotency-Key`.
   - 1re demande → `201` (1 crédit débité) ;
   - rejeu (même clé) → `200`, `replay: true`, **même** `authorization.id`,
     aucun débit supplémentaire — y compris sous concurrence
     (8 requêtes simultanées même clé → exactement 1 débit, prouvé).
5. **Épuisement** → `402 INSUFFICIENT_CREDITS` avec `details.plans`
   (les offres). Si des crédits gratuits restent, l'export gratuit reste
   possible (relais gratuits, §4.4 de la mission).
6. **Lots superposés** : chaque achat crée un lot **indépendant** avec sa
   propre expiration ; un achat ne prolonge JAMAIS un lot existant.

## 4. Endpoints

| Méthode & chemin | Auth | Réussite | Rôle |
|---|---|---|---|
| `GET /health` | — | 200 | état + environnement + mode paiement |
| `GET /ready` | — | 200 | sonde D1 (tables attendues) |
| `GET /v1/plans` | — | 200 | catalogue des 4 formules |
| `POST /v1/terminals/bootstrap` | X-Device-Id | 201 / 200 | init/retrouvaille du terminal |
| `GET /v1/terminals/me` | X-Device-Id | 200 | tableau de bord (solde, lots, pass) |
| `POST /v1/exports/authorize` | X-Device-Id + Idempotency-Key | 201 / 200 / 402 | UNE publicité = UN crédit |
| `POST /v1/payments/initiate` | X-Device-Id | 200 | transaction PENDING (24 h) |
| `POST /v1/payments/cinetpay/webhook` | — (formulaire cpm_*) | 200 | notification CinetPay |
| `GET /v1/admin/metrics` | Bearer ADMIN_METRICS_TOKEN | 200 | statistiques agrégées |
| `POST /__test__/payments/settle` | Bearer SIMULATION_SECRET | 200 | **staging uniquement** |

### 4.1 Format d'erreur normalisé

```json
{ "error": { "code": "INSUFFICIENT_CREDITS", "message": "…",
             "request_id": "uuid", "details": { … } } }
```

Codes : `INVALID_REQUEST`, `MISSING_DEVICE_ID`, `INVALID_DEVICE_ID`,
`MISSING_IDEMPOTENCY_KEY`, `INVALID_IDEMPOTENCY_KEY`, `INVALID_PRODUCT`,
`NOT_FOUND`, `UNAUTHORIZED`, `INSUFFICIENT_CREDITS` (402),
`SIMULATION_DISABLED` (404), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).

### 4.2 Limites de débit (fenêtre fixe 60 s, par terminal)

`bootstrap` 12 · `terminalRead` 60 · `exportAuthorize` **240**
(calibré pour les bancs officiels : 200 exports consécutifs < 1 min) ·
`paymentInitiate` 10 · `webhook` 120 · `admin` 30 · `publicRead` 240 ·
`simulation` 60.

## 5. Paiements

### 5.1 Initiation
`POST /v1/payments/initiate { product_code }` — le serveur crée une
transaction `PENDING` (montant/crédits/durée du catalogue), valable 24 h,
identifiée par `merchant_transaction_id` (`VVL-<horodatage>-<aléa>`).
**Aucun crédit à l'initiation.**

### 5.2 Confirmation (webhook CinetPay réel)
Format officiel : POST `application/x-www-form-urlencoded`, champs
`cpm_trans_id`, `cpm_payid`, `cpm_amount`, `cpm_currency`, `cpm_site_id`,
`signature`, … **La notification n'est PAS une preuve.** Avant tout
crédit, le serveur appelle lui-même
`POST https://api-checkout.cinetpay.com/v2/payment/check`
(apikey secrète) et exige : `cpm_result == "00"`,
`cpm_trans_status == "ACCEPTED"`, **montant strictement égal** au montant
enregistré, devise (`XOF`/`CFA`) et `site_id` exacts.
Tout écart → rejet, **aucun crédit** (`AMOUNT_MISMATCH`,
`CURRENCY_MISMATCH`, `SITE_MISMATCH`, `PROVIDER_CODE_*`,
`PROVIDER_STATUS_*`, `PROVIDER_CHECK_UNAVAILABLE`).

### 5.3 Idempotence & rejeu (prouvé par tests réels)
- Notification répétée (même référence) → `duplicate: true`, aucun crédit.
- Transaction déjà créditée → `already: true`, aucun double crédit.
- Webhooks **concurrents** sur la même transaction → exactement un lot de
  crédits (garde atomique `UPDATE … WHERE payment_status='PENDING'`).
- Échec définitif (`REFUSED`, montants divergents…) → `FAILED`
  **terminal** : un succès rejoué ensuite ne crédite jamais (anti-fraude).
- Statut non définitif (`PENDING` fournisseur) → aucun crédit, la
  transaction reste `PENDING` (réessayable).

### 5.4 Simulation (staging uniquement)
`POST /__test__/payments/settle { merchant_transaction_id, outcome }` :
- n'existe qu'en staging (`ENVIRONMENT=staging`) ; en production →
  `404 SIMULATION_DISABLED` (aucune piste) ;
- exige `SIMULATION_SECRET` (Bearer, comparaison à temps constant) ;
- passe par le **même service interne** que le webhook réel, avec le
  produit et le montant **enregistrés** à l'initiation ;
- toute réponse porte `simulated: true` — un simulé n'est jamais
  présenté comme un paiement réel.

### 5.5 Préparation CinetPay (variables prévues, désactivé)
`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY`,
`CINETPAY_ENV`, `CINETPAY_ENABLED`, `CINETPAY_API_BASE`,
`CINETPAY_NOTIFY_URL`, `CINETPAY_RETURN_URL`, `PAYMENT_MODE`.
Aucune clé fabriquée. `CINETPAY_ENABLED=false` partout aujourd'hui ;
un initiate en mode réel non configuré → `PAYMENT_PROVIDER_NOT_CONFIGURED`,
aucun crédit, aucun webhook accepté.

## 6. Base D1 — schéma (7 tables, migration 0001)

`terminals` (device_hash UNIQUE, jamais d'ANDROID_ID brut) ·
`credit_grants` (lots, `expires_at`, `UNIQUE(terminal_id, idempotency_key)`
pour les autorisations d'export via `export_authorizations`) ·
`payments` (PENDING/PAID/FAILED/CANCELLED, `UNIQUE(merchant_transaction_id)`,
`UNIQUE(provider_transaction_id)`) ·
`export_authorizations` (`UNIQUE(terminal_id, idempotency_key)`) ·
`payment_webhook_events` (`UNIQUE(provider, event_reference)` — anti-rejeu) ·
`device_events` (journal pseudonyme) · `rate_limit_counters`.

AUCUNE table comptes/promos/parrainage/vidéos/gabarits/montage/formulaire.

## 7. Environnements & secrets

| | Staging | Production |
|---|---|---|
| Worker | `vitrine-video-lite-api-staging` | `vitrine-video-lite-api` |
| D1 | `vitrine-video-lite-staging-db` | `vitrine-video-lite-production-db` |
| `ENVIRONMENT` | `staging` | `production` |
| `PAYMENT_MODE` | `simulation` | **`disabled`** |
| `CINETPAY_ENABLED` | `false` | **`false`** |
| Route simulation | active (secret requis) | **404** |

Secrets applicatifs (générés cryptographiquement via openssl/python
`secrets`, jamais committés, jamais le token Cloudflare) :
`DEVICE_ID_HMAC_SECRET` (les deux envs, valeurs distinctes),
`ADMIN_METRICS_TOKEN`, `SIMULATION_SECRET` (staging seulement).

## 8. Ce que le serveur ne fait JAMAIS

- ne stocke ni ne relaie une vidéo, un gabarit, un asset ;
- ne collecte pas le formulaire publicitaire ;
- ne renvoie ni ne journalise l'ANDROID_ID brut ;
- n'accepte pas un montant, un nombre de crédits ou une durée choisis
  par le client ;
- ne crédite pas sur une notification non vérifiée auprès du fournisseur ;
- ne propose pas de compte, promo, parrainage ou quota autre que les
  crédits.

## 9. Preuves d'exécution (résumé)

- **Local (workerd + D1 réels, vitest)** : 10 fichiers, **64/64 PASS** —
  les **15 scénarios obligatoires** réellement exécutés (tests 1-15).
- **HTTP réel** : `scripts/e2e-runner.sh staging` contre un Worker réel
  (`wrangler dev`, D1 locale) — **15/15** : 12 PASS réseau + 3
  expirations validées en FixedClock.
- Détail par scénario, verdicts et limites : REPORT_SERVER_FINAL.md.

## 10. Découpage du dépôt

```
src/            services métier + routes + sécurité (TypeScript strict)
migrations/     SQL versionné non destructif (0001_init.sql)
tests/unit/     13 tests unitaires (hash, expiration, catalogue)
tests/integration/  7 fichiers de scénarios réels (SELF.fetch + D1)
scripts/provision.sh    création D1 + migrations + secrets (idempotent)
scripts/e2e-runner.sh   15 scénarios : local (vitest) | staging (HTTP)
.github/workflows/      A qualité · B staging E2E · C production · D checkpoint
OPENAPI.yaml            spécification machine
```
