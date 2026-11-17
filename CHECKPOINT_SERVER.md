# CHECKPOINT_SERVER.md — Point de contrôle (référence de reprise)

> Mission : backend Cloudflare VITRINE VIDÉO LITE (serveur uniquement).
> Date du point : **17/11/2026** — **MISSION SERVEUR TERMINÉE**.
> État : **PRODUCTION DÉPLOYÉE ET VÉRIFIÉE** — Workers
> `vitrine-video-lite-api-staging` (E2E distant 15/15, runs B #17/#18)
> et `vitrine-video-lite-api` (production, paiements désactivés,
> run C #1) en ligne ; D1 dédiées connectées (7 tables métier chacune,
> vérifiées nom par nom) ; **21 contrôles HTTP réels PASS sur la
> production** ; simulation → 404 SIMULATION_DISABLED (preuve réelle).
> CinetPay : volontairement différé à la phase finale du projet global.

## Comptes EXACTS au point de contrôle

| Mesure | Valeur |
|---|---|
| Fichiers test | **10** (3 unitaires + 7 intégration) |
| Tests | **64/64 PASS** (13 unitaires + 51 intégration) |
| Durée pleine suite | ~18 s |
| `tsc --noEmit` | **0 erreur** |
| `eslint src tests` | **0 erreur** (13 corrigées au passage) |
| Scénarios obligatoires exécutés | **15/15** |
| E2E HTTP réel (wrangler dev + D1 locale) | **15/15** (12 PASS + 3 LOCAL FixedClock) |
| E2E réseau DISTANT (Worker staging) | **15/15** (12 réseau PASS + 3 LOCAL FixedClock) — runs **B #17 et B #18** |
| Workflows | **4** (A/B/C/D), YAML validés, garde anti-fork sur B/C/D |
| Scripts | **2** (`provision.sh`, `e2e-runner.sh`), syntaxe bash + Python embarqué validées |
| Migrations SQL | **1** (`0001_init.sql`, 16 commandes, 7 tables) |
| Commits Git (local = distant) | **17 commits**, `main` = `4536bc79ba01742b786eefd8eaee45b5d78bbd25` |
| Runs CI (derniers) | **A #16 ✓ · B #18 ✓ (staging complet) · C #1 ✓ (production complète) · D #4 ✓** (artefact final) |
| Preuve anti-course | scenario02 complet **×15 verts** après correctif (105 exécutions) |
| Dépôt GitHub | **créé** `mdgejc14-hash/vitrine-video-server` (public) |
| D1 distantes | staging `44694796-…812d`, production `17e6a5cf-…7fa2` — 7 tables métier vérifiées chacune |
| CI GitHub (cumuls) | A : 15/16 succès (seul échec #9 — course corrigée `3e0845d`) · B : 10/18, **derniers #17-#18 = déploiements complets** (échecs antérieurs corrigés) · **C : 1/1 (production complète)** · D : 4/4 + artefacts |
| Secret Actions | `CLOUDFLARE_API_TOKEN` (chiffré) — jeton avec Workers:Edit + Workers Scripts:Edit ; déploiements prouvés (B #17/#18, C #1) |

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

## DÉPLOIEMENT STAGING — RÉUSSI (runs B #17 et B #18, 17/11 07:50-07:54 UTC)

- **Worker** : `vitrine-video-lite-api-staging` —
  `https://vitrine-video-lite-api-staging.mdgejcinfluence.workers.dev`
- `/health` → 200 `{"status":"ok","environment":"staging","payment_mode":"simulation"}`
- `/ready` → 200 `{"ready":true,"database":"connected","tables":7}`
- **D1 distante** `vitrine-video-lite-staging-db` (44694796-…812d) : connectée
- **Secrets posés** (noms seuls) : DEVICE_ID_HMAC_SECRET,
  ADMIN_METRICS_TOKEN, SIMULATION_SECRET
- **E2E distant (réseau réel)** : 12 PASS + 3 LOCAL + 0 FAIL —
  dont Test 6 double variante (9 si gratuits restants ; 7e refusé si
  épuisés), Test 12 paiements invalides, Test 15 métriques avec token
- **B #18** : second déploiement complet et idempotent sur le SHA final
  `4536bc79ba01742b786eefd8eaee45b5d78bbd25` — répétabilité prouvée
  (même chaîne, E2E 15/15 à nouveau)

## DÉPLOIEMENT PRODUCTION — RÉUSSI (run C #1, 17/11 08:38 UTC)

- **Autorisation** : « DEPLOYER » explicite du fondateur (instruction
  finale du 17/11) ; garde `confirm=DEPLOYER` du workflow satisfaite
- **Worker** : `vitrine-video-lite-api` —
  `https://vitrine-video-lite-api.mdgejcinfluence.workers.dev`
- **SHA déployé** : `4a586dafe187ee767aa22a39bc9ea264642cf694`
  (runtime identique au staging vérifié : diff `4536bc7..4a586da` =
  documents + commentaires seuls, prouvé par `git diff`)
- **D1 production** : `vitrine-video-lite-production-db`
  (`17e6a5cf-788b-4e70-a3a1-bf5ad0167fa2`) — connectée ; **7 tables
  métier vérifiées nom par nom** via l'API D1 : terminals,
  credit_grants, payments, export_authorizations,
  payment_webhook_events, device_events, rate_limit_counters
- **Secrets production** (noms seuls, valeurs jamais lues) :
  `DEVICE_ID_HMAC_SECRET`, `ADMIN_METRICS_TOKEN` — générés par openssl
  dans CI, indépendants des jetons Cloudflare/GitHub ; **aucun
  SIMULATION_SECRET** en production
- **Paiements** : `PAYMENT_MODE=disabled`, `CINETPAY_ENABLED=false`
  (assertions pré-déploiement + /health réel) ; initiate → 503
  `PAYMENT_PROVIDER_NOT_CONFIGURED` — aucune transaction possible
- **Simulation** : `POST /__test__/payments/settle` → **404
  SIMULATION_DISABLED** (requête HTTP réelle sur la production)
- **Contrôles HTTP réels : 21/21 PASS** — santé (A1-A4), disponibilité
  + D1 (B1-B2), plans (C1), simulation (D1), bootstrap 3 crédits une
  seule fois (E1-E3), /terminals/me (F1), idempotence export (G1-G2),
  épuisement + 402 + offres (H1-H2), initiate refusé (I1), webhook
  rejeté (J1), métriques 401 sans token (K1), routes interdites 404
  (L1 : comptes/promos/parrainage/vidéos/briefs)
- **Terminaux de test** (données additives, marquées, réversibles —
  aucune donnée réelle) : `e2e-prod-verif-finale-1711` et `-1711b`
  (ANDROID_ID factices uuid5, préfixe explicite)
- **Anciennes ressources** : worker `vitrine-video-api` vérifié vivant
  (v0.9.1-d42.23), anciennes D1 intactes à l'inventaire — rien touché

## Clôture de la mission serveur

Tous les critères de l'instruction finale du 17/11 sont satisfaits :
Worker production réellement déployé · C #1 vert · /health 200 ·
/ready 200 + D1 production + 7 tables · secrets configurés et protégés ·
paiements strictement désactivés · simulation 404 SIMULATION_DISABLED ·
contrôles fonctionnels et sécurité validés · CHECKPOINT et REPORT à
jour · preuves archivées (runs, SHA, statuts HTTP, sorties expurgées).
- Chemin CI complet prouvé : sonde → provision → déploiement → secrets →
  attente /health → E2E réseau
- Défauts corrigés en route (chacun prouvé par exécution) : f-string
  échappée (provision), `--account-id` supprimé de wrangler 4, secrets
  APRÈS premier déploiement, activation workers.dev au 1er dépôt (code
  10007 → retentative), propagation workers.dev (attente /health),
  User-Agent Python-urllib bloqué par Cloudflare (UA explicite)

## Ancien blocage — RÉSOLU (jeton corrigé par le fondateur)

Le fondateur a régénéré le jeton avec « Workers: Edit » et
« Workers Scripts: Edit » et mis à jour le secret Actions au bon dépôt
(07:35:28 — le premier essai était allé par erreur dans
`vitrine-video-d42-arena`, détecté par horodatage du secret).

## Historique — diagnostic du blocage jeton (RÉSOLU le 17/11 07:35)

**Opération bloquée** : `PUT /accounts/d7dac13…/workers/scripts/{nom}`
(dépôt du script Worker — utilisé par `wrangler deploy`).
**Réponse** : HTTP 403 « No access to the specified resource ».
**Droit manquant** : Account → **Workers Scripts → Edit**.
**Méthodologie prouvée** : un jeton autorisé reçoit 400 sur cette même
sonde (convention CF vérifiée par exécution : requête autorisée mais
invalide → 400, cf. test D1 nom vide) ; 403 = refus d'autorisation.

**Batterie exécutée sur le jeton du secret Actions** (runs B #7 07:02 UTC
et B #8 07:06 UTC — codes HTTP seuls, aucune valeur affichée) :

| Opération | Code | Conclusion |
|---|---|---|
| GET /workers/scripts | 200 | Workers Scripts **Read** présent |
| PUT /workers/scripts (sonde) | **403** | Workers Scripts **Edit** ABSENT |
| GET /workers/subdomain | 403 | Subdomain read absent |
| GET /workers/services | 200 | lecture services OK |
| GET /d1/database | 200 | D1 opérationnel |
| GET /accounts | 200 | compte unique d7dac13… (bon ciblage) |

Carte IDENTIQUE à l'ancien jeton à l'époque (permission non
enregistrée ou secret non mis à jour).

**Résolution (17/11 07:35)** : le fondateur a régénéré le jeton avec
« Workers: Edit » + « Workers Scripts: Edit » et mis à jour le secret
au bon dépôt — le premier essai était allé par erreur dans le miroir
`vitrine-video-d42-arena` (détecté par l'horodatage du secret :
07:27:18 là-bas, 00:51:36 inchangé au bon endroit, puis 07:35:28
corrigé). Sondes suivantes : **400 = droit présent**, puis
déploiements B #17/#18 complets.

Ressources existantes : **rien n'a été touché** — ancien worker vérifié
vivant (`/health` → v0.9.1-d42.23), anciennes D1 intactes à
l'inventaire, aucune écriture dessus.

## Défaut applicatif corrigé (A #9 — classe : DÉFAUT APPLICATIF)

Run A #9 : Test 3 (8 requêtes concurrentes même clé) → « expected 2 to
7 » : séquence possible = 3 débits sérialisés (3→0) AVANT l'insertion du
gagnant → 5 fausses 402 au lieu de replays. La garantie « exactement un
débit » tenait (compensations), mais des 402 parasites n'étaient pas
acceptables. **Correctif** (`3e0845d`) : chemin d'échec du débit =
re-vérification BORNÉE de l'autorisation même clé (5×25 ms) → replay si
le gagnant insère, 402 authentique sinon. Les courses à clés différentes
restent 1×201 + N×402 (test « dernier crédit » inchangé et vert).
**Preuve** : scenario02 ×15 runs verts + A #10 vert.

## Reprise — mission serveur TERMINÉE

- **Rien à reprendre côté serveur** : production et staging déployés,
  vérifiés, documentés ; `main` propre et synchronisé.
- **Historique CI complet** : A 15/16 (seul #9 FAIL — course corrigée
  `3e0845d`) ; B #1-#4 (défauts workflow : heredocs/sonde/bits), B
  #5-#12 ✓ (tests réels, déploiement sauté — jeton sans Edit à
  l'époque), B #13-#16 (première exécution réelle : f-string,
  --account-id wrangler 4, secrets après déploiement, code 10007,
  propagation workers.dev, User-Agent), **B #17-#18 ✓ complets** ;
  **C #1 ✓ complet (production)** ; D #1-#4 ✓ (artefacts checkpoint).

## Phase suivante (hors périmètre serveur — décision fondateur)

1. **Intégration CinetPay** (fin du projet global) : clés apikey/site_id
   réelles fournies par le fondateur ; `CINETPAY_ENABLED=true` +
   `PAYMENT_MODE=cinetpay` (wrangler.jsonc production) ; secrets
   `CINETPAY_API_KEY`/`CINETPAY_SITE_ID` via `wrangler secret put` ;
   revalidation par paiement test réel + webhook signé. Le client
   `/v2/payment/check` et toutes les vérifications
   (résultat/montant/devise/site, idempotence, FAILED définitif) sont
   déjà implémentés et validés au point d'injection.
2. **Assemblage** avec l'application Android et les 20 gabarits
   (périmètres interdits au serveur — jamais entamés dans cette
   mission).
