# PRODUCT_UI_REFERENCE.md — Référence UI (14 écrans) ↔ serveur

> **Rôle de ce document** : définir, écran par écran, ce que l'application
> Android VITRINE VIDÉO LITE attend du serveur et ce qui reste **local au
> téléphone**. Le serveur est délibérément mince : il ne connaît ni
> gabarits, ni vidéos, ni formulaires.
>
> **Honnêteté sur la source** : la planche fondateur des 14 écrans
> (`vitrine_video_ecran11_corrige.png`) n'a pas pu être relue
> automatiquement dans cette session d'agent (image non visionnable
> ici). La numérotation ci-dessous est donc **indicative** ; ce qui est
> **contractuel** — et validé par les tests réels du serveur — c'est la
> répartition serveur/local et les appels API de chaque écran. Les
> libellés d'écrans sont ceux du dossier 20 gabarits (D42.34) quand ils
> existent (E4, E4b, E6, E7, E8).

## Principe directeur

- **Frontière Android absolue** : le serveur ne fait AUCUNE maquette,
  AUCUN écran, AUCUN montage. Ce document est une **référence** pour
  l'équipe UI, pas une spécification d'écrans serveur.
- **Écrans 06-07 (formulaire + tournage) : données 100 % LOCALES.**
  Rien de ce que l'utilisateur y saisit ou filme n'est envoyé au serveur.
- **Une publicité = un crédit** : la porte crédits ne s'ouvre qu'à
  l'export finalisé, pas au partage (même autorisation, même clé).

## Les 14 écrans

| # | Écran (indicatif) | Données | Appels serveur |
|---|---|---|---|
| 01 | Accueil / démarrage | local | `POST /v1/terminals/bootstrap` (1re fois) — 3 crédits offerts, une seule fois |
| 02 | Choix de la langue (FR/EN) | local | — |
| 03 | Choix du secteur (4 secteurs) | local | — |
| 04 | Catalogue des gabarits (5 par secteur) | local (gabarits embarqués dans l'app) | — |
| 05 | Fiche gabarit (aperçu, durée, prises) | local | — |
| 06 | **Brief / formulaire publicitaire (E4)** | **LOCAL** — jamais envoyé | — |
| 07 | **Conseils puis caméra guidée (E4b + E6)** | **LOCAL** — prises jamais uploadées | — |
| 08 | Aperçu de la vidéo (E7) | local | — |
| 09 | Export / rendu (E8) — « porte crédits » | local (rendu sur téléphone) | `POST /v1/exports/authorize` + `Idempotency-Key` |
| 10 | Vidéo prête / galerie | local | rejeu `POST /v1/exports/authorize` (même clé → `200 replay`, aucun débit) |
| 11 | Partage WhatsApp | local (feuille de partage Android) | **aucun** — même autorisation que l'export (§ règle one_ad_one_credit) |
| 12 | Tableau de bord crédits | serveur (solde) | `GET /v1/terminals/me` |
| 13 | Offres / pass (paywall) | serveur (catalogue) | `GET /v1/plans` ; le `402` renvoie aussi `details.plans` |
| 14 | Paiement d'un pass | serveur (transaction) | `POST /v1/payments/initiate` puis retour/notify CinetPay |

## Détail des écrans serveur-dépendants

### 01 — Démarrage / bootstrap
Au premier lancement, l'app envoie `X-Device-Id` (ANDROID_ID) à
`POST /v1/terminals/bootstrap` → `201` avec `credits.total_usable = 3`,
`free_credits_policy.reattributed_on_reinstall = false`. L'app affiche
les 3 crédits. **Réinstallation** : même appel → `200`, solde réel
conservé (peut être 0) — l'UI ne doit jamais « re-offrir » les crédits.

### 09 — Export (porte crédits)
Avant de lancer le rendu local : `POST /v1/exports/authorize` avec
l'en-tête `Idempotency-Key` (clé stable = cette publicité-ci).
- `201` → crédit débité, `authorization.id` à conserver ;
- `200 replay` → même publicité déjà autorisée (ex. reprise après crash),
  **aucun débit** — l'app poursuit l'export ;
- `402 INSUFFICIENT_CREDITS` → écran d'offres (les plans sont dans
  `error.details.plans`) ;
- `429` → réessai avec backoff.

### 10 — Vidéo prête / galerie
L'enregistrement en galerie et le rendu partagent l'autorisation de
l'écran 09. Si l'app doit « ré-autoriser » (redémarrage), elle rejoue la
MÊME `Idempotency-Key` → `200 replay`, aucun nouveau débit. C'est le
comportement prouvé par le test 3 (idempotence, concurrence incluse).

### 11 — Partage WhatsApp
Le partage utilise la feuille standard Android, fichier local.
**Aucun appel serveur supplémentaire** : enregistrer puis partager =
une seule et même autorisation (règle `one_ad_one_credit`).

### 12 — Tableau de bord
`GET /v1/terminals/me` renvoie : solde (`credits.total_usable`,
`free_remaining`, `paid_remaining`, `can_export`), tous les lots
(`grants[]` avec `status` actif/expiré/épuisé, `expires_at`), les pass
actifs (`active_passes[]`) et le catalogue (`plans[]`). L'UI affiche
l'expiration au format local (le serveur fournit l'UTC ISO-8601 et
`server_utc_now` pour la dérive d'horloge).

### 13 — Offres / paywall
`GET /v1/plans` (ou `error.details.plans` du 402) : FREE_INSTALL
0/3/sans expiration, PASS_EXPRESS 500/6/24 h, PASS_PRO 3000/90/30 j,
PASS_BOUTIQUE 7500/200/30 j. Aucune promo, aucun code, aucun parrainage —
le serveur n'expose rien d'autre.

### 14 — Paiement
`POST /v1/payments/initiate { product_code }` → `payment` PENDING
valable 24 h (`expires_at`). En production, l'UI ouvre la `payment_url`
CinetPay renvoyée par le fournisseur (mécanisme à activer avec les clés
réelles — désactivé aujourd'hui). En staging, la confirmation passe par
le simulateur (`/__test__/payments/settle`, secret serveur uniquement —
**jamais** dans l'app). Après retour, l'UI rafraîchit via
`GET /v1/terminals/me` : les crédits du pass apparaissent comme un
nouveau lot indépendant.

## Règles UI à respecter (miroir du contrat serveur)

1. Toujours envoyer `X-Device-Id` (ANDROID_ID) — jamais d'autre
   identifiant, jamais d'e-mail.
2. Une `Idempotency-Key` par publicité (UUID généré à la création de la
   publicité, conservé dans le brouillon local).
3. Ne jamais afficher un paiement simulé comme réel (staging :
  `simulation: true` dans les réponses).
4. Aucune donnée des écrans 02-08 ne quitte le téléphone.
5. Les crédits affichés viennent toujours du serveur (`/v1/terminals/me`),
   jamais d'un calcul local — lui seul connaît les expirations.
