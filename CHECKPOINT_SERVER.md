# CHECKPOINT_SERVER.md — Point de contrôle (référence de reprise)

> Mission : backend Cloudflare VITRINE VIDÉO LITE (serveur uniquement).
> Date du point : **17/11/2026** (nuit). État : **Phases 1-6 terminées
> localement ; Phase 7 (déploiement distant) bloquée par accès ; Phase 8
> (docs) livrée.**

## Comptes EXACTS au point de contrôle

| Mesure | Valeur |
|---|---|
| Fichiers test | **10** (3 unitaires + 7 intégration) |
| Tests | **64/64 PASS** (13 unitaires + 51 intégration) |
| Durée pleine suite | ~18 s |
| `tsc --noEmit` | **0 erreur** |
| `eslint src tests` | **0 erreur** (13 corrigées au passage) |
| Scénarios obligatoires exécutés | **15/15** |
| E2E HTTP réel (wrangler dev + D1 locale) | **15/15** (12 réseau PASS + 3 LOCAL FixedClock) |
| Workflows | **4** (A/B/C/D), YAML validés, garde anti-fork sur B/C/D |
| Scripts | **2** (`provision.sh`, `e2e-runner.sh`), syntaxe bash + Python embarqué validées |
| Migrations SQL | **1** (`0001_init.sql`, 16 commandes, 7 tables) |
| Commit Git | **1er commit à créer** (dépôt local initialisé, aucun commit) |

### Répartition des 15 scénarios (tous exécutés)

| Test | Fichier | Statut |
|---|---|---|
| 1 nouveau terminal (3 crédits) | scenario01 | PASS |
| 2 trois exports puis refus | scenario02 | PASS |
| 3 idempotence (concurrence incluse) | scenario02 | PASS |
| 4 réinstallation | scenario01 | PASS |
| 5 deux terminaux indépendants | scenario01 | PASS |
| 6 Pass Express (6 crédits/24 h, 7e refusé) | scenario06 | PASS |
| 7 expiration Express 24 h exactes | scenario07 | PASS (FixedClock) |
| 8 Pass Pro (90 crédits/30 j, 91e refusé) | scenario06 | PASS |
| 9 expiration Pro 30 j exactes | scenario07 | PASS (FixedClock) |
| 10 Pass Boutique (200 crédits, 201e refusé) | scenario06 | PASS |
| 11 expiration Boutique 30 j | scenario07 | PASS (FixedClock) |
| 12 paiements invalides (14 cas) | scenario12 | PASS |
| 13 pass superposés | scenario06 | PASS |
| 14 configuration (simulation staging, prod 404) | scenario14 | PASS |
| 15 statistiques admin (métriques exactes) | scenario15 | PASS |

## Décisions techniques en vigueur

- Timestamps TEXT ISO-8601 UTC ms, comparaison lexicale ; expiration
  **stricte** `now < expires_at`.
- Débit : lot payant valide expirant le plus tôt d'abord, gratuits
  préservés en dernier.
- `device_hash` = HMAC-SHA256(`DEVICE_ID_HMAC_SECRET`, `"v1:"+android_id`).
- Patterns D1 sans CTE modifiante : (a) export = réservation + insertion
  UNIQUE + compensation ; (b) paiement = UPDATE guard `PENDING` + batch.
- Échec de paiement définitif = **terminal** : un succès rejoué après
  FAILED ne crédite jamais (garde `WHERE payment_status='PENDING'`,
  réponse `already:true`, raison `ALREADY_PAID_RACE`).
- Constantes de test NON secrètes dans `wrangler.test.jsonc` **et**
  `.dev.vars` (ce dernier écrase les vars en local — voir erreurs connues).
- Rate limit `exportAuthorize` = **240/min** (bancs officiels 200 exports
  consécutifs < 1 min).
- `wrangler dev` n'applique PAS les migrations localement →
  `npm run dev` = `d1 migrations apply --local` puis `wrangler dev`.

## Blocages connus (Phase 7)

1. **Création du dépôt GitHub `mdgejc14-hash/vitrine-video-server`
   refusée (403 ×2)** avec le PAT fondateur → ne pas retenter ; le
   fondateur doit créer le dépôt (public autorisé) ou donner un PAT avec
   droit `repo` de création.
2. **Token Cloudflare inaccessible localement** (secret GitHub privé du
   compte d7dac13…) → aucun déploiement distant, aucune création D1
   distante ; `database_id` restent `PENDING_D1_CREATION_*` dans
   `wrangler.jsonc` (placeholders explicites).
3. Aucune ressource existante touchée (ancien worker/D1/B2 intacts —
   vérifié en lecture seule en Phase 1).

## Reprise — prochaine action selon l'accès disponible

- **Dépôt créé** : `git add -A && git commit` (voir §Commit ci-dessous),
  ajouter remote, pousser `main`.
- **Secret `CLOUDFLARE_API_TOKEN` ajouté** au dépôt GitHub → lancer le
  workflow **B** (déploiement staging + E2E réseau) puis **C** (production,
  confirmation `DEPLOYER`, paiements désactivés) puis **D** (checkpoint).
- **Aucun accès** : le projet reste complet et prouvé localement ;
  REPORT_SERVER_FINAL.md documente l'état exact.
