# CHECKPOINT_SERVER.md — Point de contrôle (référence de reprise)

> Mission : backend Cloudflare VITRINE VIDÉO LITE (serveur uniquement).
> Date du point : **17/11/2026** (matinée, HEAD après déploiement).
> État : **STAGING DÉPLOYÉ ET PROUVÉ** — Worker
> `vitrine-video-lite-api-staging` en ligne (workers.dev), D1 distante
> connectée (7 tables), secrets posés, **15/15 scénarios : 12 PASS en
> réseau réel + 3 LOCAL (FixedClock), 0 FAIL** (run B #17).
> Production : en attente de la confirmation « DEPLOYER » du fondateur.

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
| Commits Git (local = distant) | 12 commits, `main` = 3e0845d |
| Runs CI (17/11 matin) | A #7 ✓ #8 ✓ #9 **FAIL (course, corrigée)** #10 ✓ · B #7-#10 ✓ (tests réels, déploiement sauté à juste titre) · D #2 ✓ artefact |
| Preuve anti-course | scenario02 complet **×15 verts** après correctif (105 exécutions) |
| Dépôt GitHub | **créé** `mdgejc14-hash/vitrine-video-server` (public) |
| D1 distantes | staging `44694796-…812d`, production `17e6a5cf-…7fa2` — 7 tables métier vérifiées chacune |
| CI GitHub | A : 5/5 succès · B : run #5 succès (tests réels + saut honnête) · D : 1/1 succès + artefact · C : non déclenché (réservé fondateur) |
| Secret Actions | `CLOUDFLARE_API_TOKEN` déposé (chiffré) — inactif pour le déploiement tant que la permission manque |

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

## DÉPLOIEMENT STAGING — RÉUSSI (run B #17, 17/11 07:50 UTC)

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

## Ancien diagnostic (conservé pour la traçabilité)

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

Carte IDENTIQUE à l'ancien jeton : soit la modification de permissions
n'a pas été enregistrée, soit le secret Actions contient toujours
l'ancienne valeur.

**Actions fondateur (au choix, sans créer de nouveau jeton)** :
1. Vérifier dans CF (My Profile → API Tokens → le jeton) que la
   permission **Workers Scripts = Edit** (portée : le compte) est
   bien ENREGISTRÉE. Si le jeton a été modifié en place, sa valeur est
   inchangée : relancer simplement le workflow B.
2. Si un NOUVEAU jeton a été créé, mettre à jour le secret Actions
   `CLOUDFLARE_API_TOKEN` avec sa valeur (Settings → Secrets → Actions).
3. Vérifier l'absence de restriction IP sur le jeton (les exécutants
   GitHub Actions doivent être autorisés).

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

## Reprise — prochaine action

- **Permission corrigée sur le jeton (ou secret mis à jour)** : onglet
  Actions → workflow **B** « Run workflow » (déploie staging + E2E
  distant 15 scénarios), puis bilan staging, puis workflow **C** avec
  confirmation « DEPLOYER ». Vérifier `main` = 3e0845d avant.
- **Historique CI utile** : A #1-#8, #10 ✓ ; A #9 FAIL (course, corrigée
  par 3e0845d) ; B #5-#10 ✓ (tests réels, déploiement sauté — sonde
  403 documentée) ; B #1-#4 (défauts workflow corrigés : heredocs/sonde/
  bits) ; D #1-#2 ✓ (artefacts checkpoint-1/2).
