# CHECKPOINT_SERVER.md — Point de contrôle (référence de reprise)

> Mission : backend Cloudflare VITRINE VIDÉO LITE (serveur uniquement).
> Date du point : **17/11/2026** (nuit, mise à jetons fondateur fournis).
> État : **Phases 1-6 terminées et prouvées ; dépôt GitHub créé + poussé ;
> D1 distantes créées + migrées ; CI A/B/D verte ; déploiement Worker
> BLOQUÉ par l'unique permission « Workers Scripts:Edit » manquante.**

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
| Commits Git (local = distant) | 6 commits, `main` = 9abb388 |
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

## Blocage restant (UNIQUE)

1. **Le jeton Cloudflare fourni n'a pas la permission
   « Workers Scripts:Edit »** (PUT script → 403, PUT secret → 403 ;
   D1 pleinement opérationnel en revanche). Le déploiement du Worker
   staging puis production est donc impossible avec ce jeton.
   **Action fondateur** : ajouter la permission au jeton (même valeur —
   le secret Actions devient opérationnel immédiatement), puis relancer
   les workflows B puis C. Tout le reste est prêt et prouvé.
2. Ressources existantes : **rien n'a été touché** — ancien worker
   vérifié vivant (`/health` → v0.9.1-d42.23, 8 tables), anciennes D1
   (`vitrine-video-db`, `vitrine-video-db-preview`) intactes à
   l'inventaire, aucune écriture dessus.

## Reprise — prochaine action

- **Permission ajoutée au jeton** : onglet Actions → workflow **B**
  « Run workflow » (déploie staging + E2E réseau 15 scénarios), puis
  workflow **C** avec confirmation « DEPLOYER » (production, paiements
  désactivés), puis **D** (checkpoint). Vérifier `main` = 9abb388 avant.
- **Historique CI utile** : runs A #1-#5 (succès), B #5 (succès, tests
  réels, déploiement sauté — sondes 403), B #1-#4 (défauts workflow
  corrigés : heredocs/sonde/bits), D #1 (succès + artefact checkpoint-1).
