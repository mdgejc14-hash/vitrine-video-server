# REPORT_SERVER_FINAL.md — Rapport final du backend VITRINE VIDÉO LITE

> Mission reçue le 16/11/2026 (serveur uniquement, frontière Android
> absolue). Rapport établi le 17/11/2026.
> Verdicts possibles : **VALIDÉ PAR TEST RÉEL** / **VALIDÉ EN
> SIMULATION** / **NON TESTÉ** / **BLOQUÉ**.

## 1. Synthèse

Le backend complet (Cloudflare Worker + D1 + préparation CinetPay
désactivée) est **construit, typé, linté et prouvé localement** :
**64/64 tests PASS** dont les **15 scénarios obligatoires réellement
exécutés**, plus un rejeu **HTTP réel** des 15 scénarios contre un
Worker vivant. Le déploiement distant (Phases 7) est **BLOQUÉ** par deux
restrictions d'accès documentées (§5) — rien n'a été forcé, aucune
ressource Cloudflare existante n'a été touchée.

## 2. Verdicts par exigence

| Exigence | Preuve | Verdict |
|---|---|---|
| Worker `vitrine-video-lite-api` (code, routes /v1) | 10 endpoints (OPENAPI.yaml) ; `/health`→`{"status":"ok"…}` réel | **VALIDÉ PAR TEST RÉEL** (local) |
| D1 staging + production (création) | `scripts/provision.sh` prêt (idempotent, --only, jamais suppressif) ; non exécuté à distance | **BLOQUÉ** (token CF inaccessible localement) |
| Migrations SQL versionnées non destructives | `0001_init.sql` : 16 commandes, 7 tables, appliqué réellement (locale + bancs) | **VALIDÉ PAR TEST RÉEL** (local) |
| Terminaux pseudonymisés (ANDROID_ID → HMAC-SHA256) | tests `deviceHash` (5) ; ANDROID_ID absent de D1/réponses/journaux (tests 1/4/5, métriques sans données individuelles) | **VALIDÉ PAR TEST RÉEL** |
| Bootstrap 3 crédits une seule fois, atomique, pas de réattribution | Test 1 (201/3 crédits), Test 4 (re-bootstrap → 200, solde conservé) ; concurrence implicite UNIQUE(device_hash) | **VALIDÉ PAR TEST RÉEL** |
| Crédits + pass (4 formules figées) | Tests 6/8/10 : montants/crédits/durées exacts (500/6/86400 s ; 3000/90/2592000 s ; 7500/200/2592000 s) | **VALIDÉ PAR TEST RÉEL** |
| Expiration stricte `now < expires_at` (24 h / 30 j) | Tests 7/9/11 en `FixedClock` + voyage temporel SQL observé par HTTP réel | **VALIDÉ PAR TEST RÉEL** |
| Consommation : payant expirant le plus tôt d'abord, gratuits préservés | Test 13 (Express débité avant Pro, gratuits intacts) | **VALIDÉ PAR TEST RÉEL** |
| Une publicité = un crédit (enregistrer + partager = même autorisation) | Test 3 : rejeu même clé → même autorisation, 0 débit ; 8 concurrents même clé → exactement 1 débit | **VALIDÉ PAR TEST RÉEL** |
| Autorisations d'export idempotentes | `UNIQUE(terminal_id, idempotency_key)` + compensation ; 2 concurrents sur le dernier crédit → 1×201 + 1×402 | **VALIDÉ PAR TEST RÉEL** |
| 402 INSUFFICIENT_CREDITS + offres | Test 2 : 4e export → 402 + `details.plans` (4 formules) | **VALIDÉ PAR TEST RÉEL** |
| Initiation paiement serveur-seul (montant/crédits jamais client) | Test 12 + code : initiate ne lit que `product_code` | **VALIDÉ PAR TEST RÉEL** |
| Webhook CinetPay : vérification officielle /check, jamais la notification | `verifyCinetPayPayment` (résultat "00", ACCEPTED, montant strict, devise, site) ; 14 cas invalides testés (montant/devise/site/code/statuts/inconnu/rejeu/concurrence) | **VALIDÉ PAR TEST RÉEL** (client /check simulé au point d'injection ; **aucune clé réelle → appel réseau réel NON TESTÉ**) |
| Idempotence paiement (jamais double crédit) | rejeu même référence → DUPLICATE ; déjà PAID → already ; 3 webhooks concurrents → 1 seul lot | **VALIDÉ PAR TEST RÉEL** |
| Échec → FAILED définitif | REFUSED/CANCELLED/FAILED → FAILED, aucun crédit ; succès rejoué après échec → jamais crédité (anti-fraude) | **VALIDÉ PAR TEST RÉEL** |
| Simulation staging uniquement + SIMULATION_SECRET | Test 14 : route 401 sans/mauvais secret ; production (env simulé) → 404 SIMULATION_DISABLED ; `simulated: true` dans les réponses | **VALIDÉ PAR TEST RÉEL** |
| CinetPay désactivé partout | initiate réel non configuré → PAYMENT_PROVIDER_NOT_CONFIGURED, 0 crédit ; garde workflow C sur wrangler.jsonc | **VALIDÉ PAR TEST RÉEL** |
| Statistiques admin + ADMIN_METRICS_TOKEN | Test 15 : 401 sans token ; métriques EXACTES (4 terminaux, 12 gratuits, 4 exports, 2 PAID/1 FAILED, ventes par formule, 8 000 XOF confirmés) ; aucune donnée individuelle | **VALIDÉ PAR TEST RÉEL** |
| Déploiement staging puis production | Workflows B/C prêts ; **non exécutés** (token CF = secret GitHub uniquement) | **BLOQUÉ** |
| Dépôt GitHub `mdgejc14-hash/vitrine-video-server` | Création refusée **403 ×2** (PAT fondateur sans droit de création) — non retenté | **BLOQUÉ** |
| Workflows A (qualité) | Fichier écrit, YAML valide ; **non exécuté sur GitHub** (dépôt absent) | **NON TESTÉ** (local : tsc+eslint+vitest équivalents PASS) |
| Workflows B/C/D | Fichiers écrits, YAML valides, garde anti-fork ; **non exécutés** | **NON TESTÉ** |
| Docs (OPENAPI, contrat, référence UI 14 écrans) | Livrés (ce dépôt) ; référence UI : numérotation indicative (planche image non relue), répartition serveur/local contractuelle | **VALIDÉ EN SIMULATION** (statique) |
| E2E réseau distant (staging workers.dev) | Remplacé par E2E HTTP contre Worker réel local (15/15) | **NON TESTÉ** (distant) |

## 3. Les 15 scénarios obligatoires — résultats d'exécution

Exécution réelle, workerd + D1 (vitest-pool-workers), puis rejeu HTTP
(wrangler dev) :

| # | Scénario | Local | HTTP réel |
|---|---|---|---|
| 1 | Nouveau terminal → 3 crédits une fois | PASS | PASS |
| 2 | 3 exports gratuits puis refus (402 + offres) | PASS | PASS |
| 3 | Idempotence : une publicité, un crédit (concurrence) | PASS | PASS |
| 4 | Réinstallation : aucune réattribution | PASS | PASS |
| 5 | Deux terminaux indépendants | PASS | PASS |
| 6 | Pass Express 500 XOF → 6 crédits/24 h | PASS | PASS |
| 7 | Expiration Express : 24 h exactement | PASS | LOCAL (FixedClock) |
| 8 | Pass Pro 3 000 XOF → 90 crédits/30 j | PASS | PASS |
| 9 | Expiration Pro : 30 jours exactement | PASS | LOCAL (FixedClock) |
| 10 | Pass Boutique 7 500 XOF → 200 crédits/30 j | PASS | PASS |
| 11 | Expiration Boutique : 30 jours | PASS | LOCAL (FixedClock) |
| 12 | Paiements invalides : aucun crédit (14 cas) | PASS | PASS |
| 13 | Pass superposés : lots indépendants | PASS | PASS |
| 14 | Configuration : simulation staging, prod inexistante | PASS | PASS |
| 15 | Statistiques administratives | PASS | PASS (avec token) |

**Total : 64/64 tests locaux PASS ; 15/15 scénarios ; rejeu HTTP 15/15
(12 réseau + 3 horloge contrôlée).**

### 3.1 Interprétation du Test 6 « six exports, septième refusé »

Le banc officiel 6 dit : « six exports, le septième refusé » (Pass
Express = 6 crédits). Deux réalités coexistent selon l'état des crédits
**gratuits** au moment de l'achat, et les DEUX sont testées :

1. **Gratuits déjà consommés** (parcours officiel du banc) : solde = 6
   crédits payants → 6 exports (201), le **7e refusé** (402
   INSUFFICIENT_CREDITS + offres). C'est le comportement du banc :
   Test 6 vérifie exactement 6×201 puis 402.
2. **Gratuits restants** (cas d'usage réel) : 3 gratuits + 6 du pass =
   9 utilisables ; §4.4 de la mission — les crédits gratuits servent de
   relais — le 7e export est alors **autorisé** (il débite un gratuit,
   lot payant préservé car expire plus tard). Le Test 13 couvre ce
   croisement de lots.

Le serveur est donc conforme dans les DEUX réalités : il refuse le 7e
quand il ne reste que le pass épuisé, et l'autorise si des gratuits
subsistent. L'affichage « 7e refusé » du banc suppose les gratuits
épuisés — hypothèse validée explicitement par le test 6 (les 3 gratuits
sont consommés avant l'achat dans ce banc).

## 4. Sécurité & conformité (constats)

- Aucun secret committé : `.dev.vars` (gitignore) ne contient que des
  constantes de test non secrètes, identiques à `wrangler.test.jsonc` ;
  les secrets réels ne vivront qu'en distant (`wrangler secret put` /
  workflow). Le workflow C vérifie l'absence de motif de clé committé.
- ANDROID_ID : jamais en clair — D1 (hash HMAC), journaux (pseudonyme),
  réponses (pseudonyme), rapports (aucun).
- Comparaison du secret de simulation à temps constant ; limite de corps
  8 Ko (64 Ko webhook) ; CORS restreint ; erreurs normalisées avec
  `request_id`.
- Aucune table comptes/promos/parrainage/vidéos/gabarits ; aucun stockage
  vidéo ; le formulaire publicitaire ne transite jamais.
- Anciennes ressources Cloudflare (worker `vitrine-video-api`, D1
  `0dacf519…`/`5b9060b1…`, bucket B2 `vitrine-video-media`) :
  **aucune modification** — audit lecture seule Phase 1, jamais
  référencées dans la config.

## 5. Blocages restants (actions fondateur)

1. **Créer le dépôt GitHub** `mdgejc14-hash/vitrine-video-server`
   (public autorisé) — le PAT fondateur actuel ne peut pas créer de dépôt
   (403, deux tentatives méthodiques, non retentées). Ensuite :
   `git push` du dépôt local complet.
2. **Ajouter le secret** `CLOUDFLARE_API_TOKEN` dans le dépôt GitHub
   (Actions) pour débloquer B (staging) puis C (production, confirmation
   « DEPLOYER », paiements désactivés) puis D (checkpoint hebdomadaire).
3. Les `database_id` de `wrangler.jsonc` sont des placeholders
   `PENDING_D1_CREATION_*` : le workflow B/C les remplit via
   `provision.sh --apply-config` sans jamais les committer.

## 6. Limites honnêtes

- Le client HTTP CinetPay réel (`/v2/payment/check` sur
  api-checkout.cinetpay.com) n'a **jamais été appelé avec de vraies
  clés** (aucune clé existante — budget 0 FCFA, compte 501) : la
  vérification est validée au point d'injection du résultat /check.
  Le jour de l'activation, revalider par un paiement test réel CinetPay.
- La référence UI 14 écrans : numérotation indicative (planche image non
  relisible par l'agent) ; la répartition serveur/local et les appels
  API sont, eux, contractuels et testés.
- Les workflows GitHub n'ont jamais tourné (dépôt inexistant) : leur
  syntaxe est validée (YAML), leur exécution restera NON TESTÉE jusqu'au
  push.
- Aucun développement Android n'a été fait (frontière respectée) ; aucun
  ancien dépôt n'a été modifié.
