# AUDIT_SERVER_APP_COMPATIBILITY.md — Audit de correspondance serveur ↔ parcours applicatif

> **Date de l'audit** : 17/11/2026 (matinée, UTC).
> **SHA du code inspecté** : `533b7b669e22f2c1ff7d7c3e293859d7ce2a1fcc`
> (staging déployé à ce SHA par B #19 ; production déployée à
> `4a586dafe187ee767aa22a39bc9ea264642cf694`, runtime identique —
> diff `4536bc7..4a586da` = documents + commentaires seuls).
> **URL staging** : https://vitrine-video-lite-api-staging.mdgejcinfluence.workers.dev
> **URL production** : https://vitrine-video-lite-api.mdgejcinfluence.workers.dev
> **Méthode** : audit sans reconstruction, sans correction de code, sans
> transaction réelle, sans modification de production. Tests consommant
> des crédits effectués en staging sur terminaux fictifs marqués
> `e2e-audit-*` ; production en lecture seule (terminal de test
> préexistant `e2e-prod-verif-finale-1711b`, créé lors de la mission de
> déploiement).
> **Verdicts autorisés** : VALIDÉ PAR TEST RÉEL · VALIDÉ PAR TEST EN
> STAGING · VALIDÉ PAR INSPECTION DU CODE · À VÉRIFIER AVEC ANDROID ·
> VOLONTAIREMENT DÉSACTIVÉ · NON TESTÉ · ÉCHEC.

---

## 1. Les quatre moments d'intervention du serveur

### A. Écran 03 — Chargement / Initialisation : `POST /v1/terminals/bootstrap`

| Exigence | Preuve | Verdict |
|---|---|---|
| Reconnaissance du téléphone par identifiant pseudonymisé | Code : `device_hash = HMAC-SHA256(DEVICE_ID_HMAC_SECRET, "v1:"+android_id)` (`src/security/hmac.ts`) ; `terminals.device_hash` UNIQUE (`migrations/0001_init.sql`) ; rate-limit identifié par le hash, jamais l'ID brut (`src/index.ts` requestIdentity) | VALIDÉ PAR INSPECTION DU CODE |
| Attribution d'exactement 3 crédits gratuits à un nouveau terminal | Test réel staging (audit 17/11) : bootstrap `e2e-audit-s12-402retry` → **201**, grant `free_install` 3 crédits ; test réel production (17/11, mission déploiement) : 201 + 3 crédits | VALIDÉ PAR TEST RÉEL (staging + production) |
| Terminal existant → solde restitué, AUCUN crédit recréé | Staging : 13 bootstraps consécutifs même terminal → 1×201 puis 200, solde inchangé ; production : re-bootstrap → 200, aucun crédit réattribué ; E2E CI test 4 (B #17/#18/#19) | VALIDÉ PAR TEST RÉEL |
| Réinstallation/redémarrage → jamais de réattribution | La réattribution est impossible par construction : le crédit gratuit est un lot `free_install` unique par `terminal_id` (INSERT seulement à la création du terminal, course résolue par UNIQUE(device_hash)) ; rejeu HTTP prouvé ci-dessus | VALIDÉ PAR TEST RÉEL + INSPECTION |
| ANDROID_ID brut jamais conservé (D1, journaux, réponses) | Schéma D1 : colonne `device_hash` seule (+ `hash_key_version`) ; réponses : `pseudonym: "term-xxxx"` — vérifié par test réel (chaîne ANDROID_ID factice absente des réponses staging ET production) ; journaux : aucun `console.*` d'ID brut dans `src/` | VALIDÉ PAR TEST RÉEL + INSPECTION |
| Données nécessaires à l'application retournées | Réponse bootstrap/`me` : `terminal` (pseudonyme, dates), `credits` (total/free/paid/can_export), `grants` (lots, dates, expiration), `active_passes` | VALIDÉ PAR TEST RÉEL |

### B. Écrans 08-09-10 — Filmage, aperçu, montage : AUCUN appel serveur

| Exigence | Preuve | Verdict |
|---|---|---|
| Aucun upload vidéo/photo/rush/gabarit/texte | Routeur : exactement 10 routes (health, ready, plans, bootstrap, me, authorize, initiate, webhook, metrics, settle-test) — aucun endpoint d'upload ; limite corps 8 Ko (64 Ko webhook) avec message explicite « ce backend n'accepte aucun média » ; commentaire d'architecture en tête de `src/index.ts` | VALIDÉ PAR INSPECTION DU CODE |
| Aucun endpoint ne consomme un crédit pendant filmage/montage | Seul `POST /v1/exports/authorize` débite (réservation atomique `debitOneCredit`) ; aucun autre chemin d'écriture de `credits_remaining` hors compensation et règlement de paiement | VALIDÉ PAR INSPECTION DU CODE |
| Montage non conditionné par une autorisation serveur | Aucune route « render/montage » ; le serveur n'a aucune connaissance du montage (aucune table, aucun champ) | VALIDÉ PAR INSPECTION DU CODE |
| Frontière local/serveur documentée | BACKEND_CONTRACT.md + PRODUCT_UI_REFERENCE.md (écrans 06-10 « locaux », serveur absent) + OPENAPI.yaml (10 routes) | VALIDÉ PAR INSPECTION DU CODE |
| L'application n'effectuera AUCUN appel réseau involontaire pendant 08-10, et le montage fonctionne hors connexion après bootstrap | **Non démontrable depuis le backend** — exige une instrumentation Android (compteur de requêtes, mode avion) | **À VÉRIFIER AVEC ANDROID** |

### C. Écran 11 — Vidéo finale : `POST /v1/exports/authorize` (point de consommation)

**Contrat d'idempotence implémenté et prouvé** :

| Exigence | Preuve | Verdict |
|---|---|---|
| Cas 1 — au moins un crédit : autorisation + exactement 1 débit | Staging : 201 + `credits.paid_remaining` décrémenté de 1 ; production : 201 + débit unique (mission déploiement, contrôle G1) | VALIDÉ PAR TEST RÉEL |
| Même autorisation pour Enregistrer ET Partager (second bouton = 0 débit) | Rejeu même `Idempotency-Key` → **200**, MÊME `authorization.id`, solde inchangé — prouvé en staging (audit 12.9) ET production (G2) ; réponse marquée `rule: "one_ad_one_credit"` | VALIDÉ PAR TEST RÉEL (staging + production) |
| Coupure réseau + nouvelle tentative = 0 double débit | Rejeu même clé (ci-dessus) + concurrence : 8 requêtes simultanées même clé → exactement 1 débit, les autres en replay (E2E CI test 3, runs B #17/#18/#19 ; défaut de course corrigé `3e0845d`, preuve ×15) | VALIDÉ PAR TEST RÉEL |
| Cas 2 — solde nul : `402 INSUFFICIENT_CREDITS` + catalogue 4 offres, 0 débit | Staging : 402 + `error.details.plans` = [FREE_INSTALL 0/3/∞, PASS_EXPRESS 500/6/86400 s, PASS_PRO 3000/90/2592000 s, PASS_BOUTIQUE 7500/200/2592000 s] ; solde inchangé après refus ; production : 402 + 4 offres (H2) | VALIDÉ PAR TEST RÉEL (staging + production) |
| Cas 3 — requêtes simultanées/répétées : 1 seul débit | Idem concurrence + `UNIQUE(terminal_id, idempotency_key)` + compensation `creditBack` + re-vérification bornée (5×25 ms) dans le chemin d'échec | VALIDÉ PAR TEST RÉEL |
| **402 puis paiement puis nouvel essai avec la MÊME clé** | **Test obligatoire exécuté en staging (17/11)** : terminal `e2e-audit-s12-402retry` — 3 gratuits consommés → demande clé K → **402** + offres, solde 0 → attribution d'un pass PASS_EXPRESS (6 crédits/24 h, insertion D1 staging = simulation d'achat, le secret de simulation étant réservé au CI) → **rejeu même clé K → 201** + exactement 1 débit (paid 6→5) → rejeu K → **200**, même autorisation, toujours 5 → lots : gratuit 0/3, pass 5/6, expiration 24,00 h | **VALIDÉ PAR TEST EN STAGING** |
| L'implémentation permet le contrat applicatif (clé par publicité finalisée, réutilisée pour les 2 boutons et les répétitions, nouvelle clé pour nouvelle publicité, conservation pour reprise) | Mécanisme : replay prioritaire par `(terminal_id, idempotency_key)` ; un 402 ne persiste RIEN (aucun verrou d'échec) donc le rachat débloque la même clé ; format accepté `^[A-Za-z0-9._:-]{8,128}$` ; la génération/conservation des clés est du ressort de l'application | VALIDÉ PAR TEST EN STAGING (comportement serveur) + **À VÉRIFIER AVEC ANDROID** (gestion des clés côté application) |
| Authorize déclenché SEULEMENT au clic Enregistrer/Partager (pas à la fin du montage ni à l'ouverture de l'écran 11) | Le serveur ne peut pas savoir quand l'application appelle — c'est une règle d'intégration Android | **À VÉRIFIER AVEC ANDROID** |

### D. Écran 12 — Tableau de bord : `GET /v1/terminals/me` + `GET /v1/plans`

| Exigence | Preuve | Verdict |
|---|---|---|
| /me avec identification prévue | Production (lecture seule) : 200 avec pseudonyme + `credits` {total_usable, free_remaining, paid_remaining, can_export} | VALIDÉ PAR TEST RÉEL (production) |
| Lots + dates d'expiration des pass actifs | Production : `grants[]` (type, crédits, starts/expires_at) + `active_passes[]` ; staging : pass à 24,00 h exactement (audit 12.11) | VALIDÉ PAR TEST RÉEL |
| /plans catalogue complet et cohérent | Production : 200, XOF, **exactement** FREE 0/3/`null`, EXPRESS 500/6/**86400 s**, PRO 3000/90/**2592000 s**, BOUTIQUE 7500/200/**2592000 s** (durées vérifiées en secondes, pas arrondies) | VALIDÉ PAR TEST RÉEL (production) |

### E. Écran 13 — Paiement : `POST /v1/payments/initiate` (CinetPay volontairement différé)

| Exigence | Preuve | Verdict |
|---|---|---|
| Le téléphone ne transmet que `product_code` | Route : seul `product_code` lu du corps ; prix/crédits/durée from catalogue serveur (`src/catalog/plans.ts`) | VALIDÉ PAR INSPECTION DU CODE |
| Route existante + verrouillage production | Production : initiate → **503 `PAYMENT_PROVIDER_NOT_CONFIGURED`** (mission déploiement, contrôle I1) — aucune transaction créée | VALIDÉ PAR TEST RÉEL (production) |
| Aucun crédit sans confirmation officielle | Crédit pass uniquement via webhook vérifié (`paymentService` : UPDATE guard `WHERE payment_status='PENDING'`) ; 14 cas invalides testés (E2E CI test 12) | VALIDÉ PAR TEST EN STAGING |
| Simulations impossibles en production | `POST /__test__/payments/settle` → **404 `SIMULATION_DISABLED`** (requête réelle production, re-vérifiée à l'audit) ; aucun `SIMULATION_SECRET` en production | VALIDÉ PAR TEST RÉEL (production) |
| `PAYMENT_MODE=disabled`, `CINETPAY_ENABLED=false` préservés | Assertions pré-déploiement du workflow C + `/health` production : `payment_mode: disabled` (audit P1) | VALIDÉ PAR TEST RÉEL (production) |
| Architecture prête pour CinetPay (contrôles futurs) | `src/payments/verification.ts` : appel officiel `/v2/payment/check`, `cpm_result "00"`, statut ACCEPTED, **montant strictement égal** (`Math.trunc === expected`), devise **XOF** (ou « CFA », même Franc CFA), `site_id` strict, `transaction_id` égal ; rejet des notifications non vérifiées ; journal `payment_webhook_events` avec contraintes UNIQUE (rejeu → `DUPLICATE`) ; `ALREADY_PAID` sans double crédit ; verrou définitif PAID/FAILED (guard `PENDING`) ; 3 webhooks concurrents → 1 seul lot (E2E CI) | VALIDÉ PAR INSPECTION DU CODE + TEST EN STAGING (points d'injection) |
| Appel réseau réel à CinetPay | Volontairement non effectué (aucune clé, aucune demande) | **VOLONTAIREMENT DÉSACTIVÉ** |

---

## 2. Règles financières

| Exigence | Preuve | Verdict |
|---|---|---|
| Lots indépendants (quantité + durée propres, jamais fusionnés) | 1 ligne `credit_grants` par attribution (schéma) ; /me affiche chaque lot ; staging : gratuit 0/3 + pass 5/6 côte à côte (audit 12.10) | VALIDÉ PAR TEST EN STAGING |
| Expiration stricte `now < expires_at` | SQL : `(expires_at IS NULL OR expires_at > ?now)` — à l'instant exact `expires_at`, `>` est faux → expiré ; statut `expired` non réactivable ; tests FixedClock 24 h/30 j exacts (vitest, 3 scénarios) | VALIDÉ PAR TEST EN STAGING (horloge contrôlée) + INSPECTION |
| Priorité : payant expirant le plus tôt d'abord, gratuits préservés | SQL : `ORDER BY (expires_at IS NULL) ASC, expires_at ASC LIMIT 1` — NULL (gratuits) en dernier ; E2E CI test 13 (Express débité avant Pro, gratuits intacts après achat tant que payants valides) | VALIDÉ PAR TEST EN STAGING + INSPECTION |
| 402 + catalogue uniquement quand TOUT solde valide épuisé | Le solde EXCLUT les lots expirés (`now < expires_at`) — un pass épuisé ne masque pas des gratuits restants : composition réelle du solde (`free_remaining`/`paid_remaining` séparés, `can_export`) ; 402 renvoie les 4 offres dans `error.details.plans` | VALIDÉ PAR TEST RÉEL |

---

## 3. Boutons et actions 100 % locaux (aucune dépendance serveur)

Langue, accueil, secteur, gabarit, nom de boutique, produit/plat, prix,
numéro WhatsApp, localisation, phrase publicitaire, caméra, aperçu,
montage, support WhatsApp.

- Routeur : **aucune route** pour ces interactions (10 routes au total,
  toutes listées en §1) ; les contrats API (OPENAPI.yaml) ne réclament
  aucune de ces données ; le formulaire publicitaire ne transite jamais
  (limite 8 Ko + aucun champ de brief dans le schéma D1).
- Support WhatsApp : aucun endpoint ticket/message — l'écran 14 ouvre
  WhatsApp localement. **VALIDÉ PAR INSPECTION DU CODE.**
- Le comportement réellement hors-ligne de l'application pendant ces
  écrans : **À VÉRIFIER AVEC ANDROID** (instrumentation).
- Aucun nouvel endpoint créé pour cet audit (règle respectée).

---

## 4. Sécurité et sobriété

### A. Absence de données/fonctionnalités superflues

| Vérification | Preuve | Verdict |
|---|---|---|
| Comptes, inscription, email/mot de passe, auth Google | Aucune table (7 tables : terminals, credit_grants, payments, export_authorizations, payment_webhook_events, device_events, rate_limit_counters) ; aucune route /v1/accounts, /v1/auth… (404 vérifiés en production) | VALIDÉ PAR TEST RÉEL (production, 404) |
| Promos, parrainage, affiliation, récompenses | Aucune table/route ; requêtes réelles → 404 | VALIDÉ PAR TEST RÉEL (production, 404) |
| Transfert de crédits entre téléphones | Aucune route de transfert ; les crédits appartiennent à `terminal_id` (clé du débit) | VALIDÉ PAR INSPECTION DU CODE |
| Stockage vidéos/photos/rushes/briefs/gabarits | Aucune table média ; limite 8 Ko ; commentaires d'architecture explicites | VALIDÉ PAR INSPECTION DU CODE |

### B. Confidentialité des téléphones

- `device_hash = HMAC-SHA256(DEVICE_ID_HMAC_SECRET, "v1:"+android_id)` ;
  secret exclusivement côté Worker (secret Cloudflare, généré par
  openssl en CI, indépendant des jetons CF/GitHub) ; jamais dans les
  réponses, journaux ou rapports — **VALIDÉ PAR TEST RÉEL + INSPECTION**.
- Chaque téléphone = son solde (staging : 2 téléphones, soldes
  distincts maintenus) — **VALIDÉ PAR TEST EN STAGING**.
- **Limite honnête** (exigée par la mission) : le HMAC pseudonymise le
  stockage, il ne s'agit PAS d'une garantie absolue contre la fraude —
  une réinitialisation d'ANDROID_ID (ou un appareil rooté) produit un
  nouveau terminal et donc 3 nouveaux crédits gratuits ; le code
  documente lui-même cette limite (`src/security/hmac.ts`). Aucune
  contre-mesure (device attestation, play-integrity) n'est prévue dans
  le périmètre actuel.

### C. Isolation de l'ancien projet

- Aucune référence de code/config à l'ancien worker `vitrine-video-api`,
  aux anciennes D1 (`vitrine-video-db`, `-preview`) ou au stockage des
  600 pistes audio (grep complet : seules des mentions en commentaire
  documentaire) — **VALIDÉ PAR INSPECTION DU CODE**.
- Ancien worker vérifié vivant (`/health` → v0.9.1-d42.23), anciennes
  D1 présentes à l'inventaire, aucune écriture — **VALIDÉ PAR TEST RÉEL (lecture)**.

### D. Protection technique (valeurs, comportement, tests)

| Mécanisme | Valeur configurée | Test réel (staging, 17/11) | Verdict |
|---|---|---|---|
| Rate limit bootstrap | **12/min** (fenêtre fixe 60 s, par hash de terminal ou IP) | 13 requêtes rapides même terminal → **12 acceptées, 13e = 429** | VALIDÉ PAR TEST EN STAGING |
| Rate limit lecture /me | 60/min | (mécanisme identique, même code `checkRateLimit`) | VALIDÉ PAR INSPECTION (+ mécanisme prouvé ci-dessus) |
| Rate limit authorize | 240/min (bancs officiels 200 exports < 1 min) | mécanisme identique | VALIDÉ PAR INSPECTION |
| Rate limit initiate | **10/min** | 11 requêtes → **10 acceptées, 11e = 429** | VALIDÉ PAR TEST EN STAGING |
| Rate limit webhook / admin / public / simulation | 120 / 30 / 240 / 60 par min | mécanisme identique | VALIDÉ PAR INSPECTION |
| Taille des requêtes | **8 Ko** (64 Ko webhook) | corps 9 Ko → **413 REQUEST_TOO_LARGE** ; webhook 70 Ko → **413** | VALIDÉ PAR TEST EN STAGING |
| Validation des entrées | x-device-id hex 8-64, Idempotency-Key `^[A-Za-z0-9._:-]{8,128}$`, product_code catalogue, JSON strict | tests vitest + E2E (INVALID_DEVICE_ID, INVALID_REQUEST…) | VALIDÉ PAR TEST EN STAGING |
| Appels répétés/simultanés | replay + UNIQUE + compensation + re-vérification bornée | 8 concurrents même clé → 1 débit (E2E CI ×3 runs) | VALIDÉ PAR TEST EN STAGING |
| Erreurs normalisées | `{error:{code,message,request_id,details?}}` | observées sur 401/402/404/413/429/503 réels | VALIDÉ PAR TEST RÉEL |
| CORS | aucune origine navigateur autorisée à lire les réponses métier ; preflight honnête 204 | inspection (`src/index.ts`) | VALIDÉ PAR INSPECTION DU CODE |
| Routes administratives | `ADMIN_METRICS_TOKEN` requis | sans token → **401** (production) ; avec token → 200 stats (E2E CI test 15) | VALIDÉ PAR TEST RÉEL |
| Route simulation | secret Bearer + 60/min ; production → 404 | sans secret → 401 (E2E) ; production → 404 SIMULATION_DISABLED (réel) | VALIDÉ PAR TEST RÉEL |
| Secrets dans le dépôt/journaux | aucun | workflow C « Vérification — aucun secret dans le dépôt » vert ; secrets en Cloudflare uniquement | VALIDÉ PAR INSPECTION (CI) |

### E. Métriques administratives

- Sans token : **401** (production, re-vérifié à l'audit P6).
- Avec token : statistiques fournies (E2E CI test 15, run B #19) :
  compteurs uniquement (COUNT/SUM/GROUP BY — terminals, crédits,
  exports, statuts paiements, ventes par formule, montant total) :
  **aucune donnée individuelle** (aucun terminal_id, aucun pseudonyme,
  aucun ANDROID_ID dans les métriques — inspection `metricsService.ts`).
  **VALIDÉ PAR TEST EN STAGING + INSPECTION.**

---

## 5. Les 19 scénarios particuliers — résultats explicites

| # | Scénario | Résultat | Méthode |
|---|---|---|---|
| 1 | Premier lancement : 3 crédits | **PASS** — 201 + grant free_install 3 | Test réel (staging audit + production) |
| 2 | Deuxième lancement : aucun nouveau crédit | **PASS** — 200, solde inchangé (13 bootstraps consécutifs) | Test réel (staging + production) |
| 3 | Deux téléphones : deux soldes distincts | **PASS** — tél. 1 = 5 payants, tél. 2 = 3 gratuits, jamais mélangés | Test réel (staging) |
| 4 | Filmage : aucun crédit consommé | **PASS (par architecture)** — aucun endpoint appelable ne débit | Inspection + **instrumentation Android requise** |
| 5 | Aperçu : aucun crédit consommé | idem | Inspection + Android |
| 6 | Montage : aucun crédit consommé | idem | Inspection + Android |
| 7 | Fin du montage : aucun débit automatique | **PASS (par architecture)** — seul authorize débite, déclenché par le client | Inspection + Android (moment de l'appel) |
| 8 | 1er clic « Enregistrer » : 1 autorisation + 1 débit | **PASS** — 201, paid 6→5 (staging) / 201 + débit (production) | Test réel |
| 9 | Clic « Partager » : même autorisation, 0 débit | **PASS** — 200, même id, solde inchangé | Test réel (staging + production) |
| 10 | Coupure réseau + retry : aucun double débit | **PASS** — rejeu même clé + 8 concurrents → 1 débit | Test réel (staging + CI) |
| 11 | Solde nul : 402 + catalogue 4 offres | **PASS** — `error.details.plans` complet | Test réel (staging + production) |
| 12 | Paiement puis nouvelle autorisation même clé | **PASS** — 402 (clé K) → pass attribué → rejeu K = **201** + 1 débit → rejeu K = 200, toujours 1 débit | **Test en staging (obligatoire, exécuté)** |
| 13 | Tableau de bord : solde, lots, expirations, offres | **PASS** — /me + /plans exacts (durées en secondes vérifiées) | Test réel (production) |
| 14 | Paiement en production : refus propre | **PASS** — 503 PAYMENT_PROVIDER_NOT_CONFIGURED | Test réel (production) |
| 15 | Webhook non vérifié : aucun crédit | **PASS** — 14 cas invalides (CI) + rejet 400 (production) | Test réel |
| 16 | Simulation en production | **PASS** — 404 SIMULATION_DISABLED | Test réel (production, re-vérifié) |
| 17 | Métriques sans token | **PASS** — 401 | Test réel (production) |
| 18 | Requête abusive/surdimensionnée | **PASS** — 429 aux limites exactes (12/min, 10/min), 413 à 9 Ko/70 Ko, trafic normal non bloqué | Test réel (staging) |
| 19 | Anciennes ressources | **PASS** — aucune dépendance (inspection), ancien worker vivant, anciennes D1 intactes | Inspection + lecture réelle |

---

## 6. Anomalies

**Aucune anomalie serveur bloquante découverte.** Précisions honnêtes :

1. Les trois « FAIL » initiaux de mon script d'audit (chemins
   `details.plans`, `credits_after`) étaient des erreurs d'extraction
   du script de test, pas des réponses serveur — corrigés et revalidés
   par inspection des corps réels (les offres sont dans
   `error.details.plans`, le solde post-débit dans `credits`).
2. Limite structurelle documentée : l'identification par ANDROID_ID
   HMAC est une pseudonymisation, pas une garantie anti-fraude absolue
   (réinitialisation d'ID → nouveaux crédits gratuits). Accepté par
   conception pour ce produit.
3. Le test « 402 → achat → rejeu » a été mené avec attribution du pass
   par insertion D1 directe en staging (environnement de test) car le
   secret de simulation staging ne vit que dans le cache CI —
   équivalent fonctionnel du règlement simulé, sans contournement de
   production.

## 7. Éléments dépendant d'Android (à contrôler à l'intégration)

1. **Moment de l'appel authorize** : uniquement au clic
   « Enregistrer » / « Partager » (jamais fin de montage ni ouverture
   écran 11).
2. **Gestion des clés d'idempotence côté application** : une clé unique
   par publicité finalisée (format `^[A-Za-z0-9._:-]{8,128}$`), la même
   pour les deux boutons et les répétitions réseau, conservée
   suffisamment longtemps pour reprendre une tentative interrompue,
   nouvelle clé pour une nouvelle publicité.
3. **Aucun appel réseau involontaire** pendant les écrans 01-10 et 14
   (instrumentation : compteur de requêtes).
4. **Montage hors connexion** après un premier bootstrap réussi (mode
   avion).
5. **Présentation du 402** : l'application doit proposer l'achat (le
   MP4 monté reste local) puis rejour la MÊME autorisation avec la
   MÊME clé — comportement serveur prouvé, UX à confirmer.

## 8. Éléments volontairement reportés à la connexion CinetPay

1. Clés réelles (apikey + site_id) — à fournir par le fondateur.
2. `CINETPAY_ENABLED=true`, `PAYMENT_MODE=cinetpay` (production).
3. Secrets `CINETPAY_API_KEY` / `CINETPAY_SITE_ID` (wrangler secret put).
4. Revalidation par paiement test réel + webhook signé.
5. Aucune refonte : vérification `/v2/payment/check` (00/ACCEPTED,
   montant exact, XOF, site_id), anti-rejeu, anti-double-crédit et
   verrou PAID/FAILED déjà implémentés et testés au point d'injection.

---

## 9. Réponses aux 10 questions finales

1. **Bootstrap du premier lancement ?** OUI — prouvé par tests réels
   staging et production (3 crédits uniques, réattribution impossible,
   pseudonymie HMAC).
2. **Solde et catalogue des pass ?** OUI — lots distincts, priorité de
   consommation, expiration stricte, catalogue exact au XOF et à la
   seconde près (production).
3. **Débit uniquement à l'export final (écran 11) ?** OUI côté serveur —
   `authorize` est le seul point de débit, jamais déclenché par le
   serveur lui-même ; le moment de l'appel reste un contrat
   d'intégration Android.
4. **Enregistrer + partager sans double débit ?** OUI — même clé =
   même autorisation (200 replay), prouvé en staging et production,
   y compris sous concurrence.
5. **Publicité refusée (402) débloquée après achat avec la même clé ?**
   OUI — test obligatoire exécuté en staging : 402 → pass → rejeu
   même clé = 201 + exactement 1 débit ; un 402 ne laisse aucune trace
   bloquante.
6. **Montage entièrement local ?** OUI par architecture (aucun endpoint,
   aucune donnée requise) ; comportement applicatif hors-ligne à
   confirmer avec Android.
7. **Paiements sécurisés et volontairement désactivés ?** OUI —
   production : 503 PAYMENT_PROVIDER_NOT_CONFIGURED, simulation 404,
   secrets absents, architecture CinetPay complète en attente de clés.
8. **Confidentialité, sécurité, indépendance des téléphones ?** OUI —
   HMAC uniquement, secrets côté Worker, soldes indépendants, aucune
   donnée individuelle dans les métriques, protections prouvées par
   tests (429/413/401/404) ; réserve honnête : pseudonymie ≠ garantie
   anti-fraude absolue.
9. **Comportements confirmables seulement après intégration Android ?**
   Les 5 points du §7 (moment de authorize, gestion des clés, absence
   d'appels involontaires, montage hors-ligne, UX du 402).
10. **Défaut réel à corriger avant assemblage ?** NON — aucun défaut
    serveur découvert ; le serveur est prêt à être raccordé.

## Verdict final

**SERVEUR COMPATIBLE SOUS RÉSERVE DES POINTS IDENTIFIÉS.**

Toutes les exigences serveur sont validées (tests réels staging et
production, inspection preuve à l'appui, zéro anomalie bloquante).
Les réserves ne portent sur aucun défaut serveur : ce sont les
contrôles d'intégration Android (§7) et la limite structurelle assumée
de la pseudonymisation (§6.2) — à traiter au moment du raccordement de
l'application, avec la liste de contrôle ci-dessus.
