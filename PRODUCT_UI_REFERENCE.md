# PRODUCT_UI_REFERENCE.md — Référence UI officielle (14 écrans) ↔ serveur

> **Source de vérité** : planche fournie par le fondateur — 14 écrans
> exacts, intitulés, numérotation et ordre repris ci-dessous à
> l'identique. Ce document est une **référence fonctionnelle backend** :
> il définit, écran par écran, ce que l'application Android attendra du
> serveur et ce qui reste local au téléphone. Il ne constitue ni une
> maquette, ni un développement Android (frontière absolue : serveur
> uniquement).

## Principe directeur

- **Modèle** : un téléphone = un terminal pseudonymisé = un solde de
  crédits et des pass. Aucun compte, aucun e-mail, aucun parrainage.
- **Écrans 01 à 10** : données et traitements **locaux** (choix, secteur,
  gabarits, formulaire, récapitulatif, caméra, aperçu, montage). Rien de
  ce qui s'y passe ne transite par le serveur — à l'exception du
  bootstrap de l'écran 03.
- **Écran 11** : la porte crédits — **une publicité finalisée = un seul
  crédit**, que l'utilisateur enregistre puis/ou partage sur WhatsApp.
- **Écrans 12 et 13** : tableaux de bord et paiement, alimentés par le
  serveur.
- **Écran 14** : support WhatsApp, aucune API.

## Les 14 écrans officiels

| N° | Écran officiel | Fonction | Données | Appels serveur |
|---|---|---|---|---|
| 01 | Choix de la langue | Français ou English | locale | — |
| 02 | Accueil / Bienvenue | Présentation de VITRINE VIDÉO | locale | — |
| 03 | Chargement / Initialisation | Initialisation du terminal | serveur | `POST /v1/terminals/bootstrap` |
| 04 | Choix du secteur | Sélection parmi les quatre secteurs | locale | — |
| 05 | Catalogue de gabarits | Cinq gabarits du secteur choisi | locale | — |
| 06 | Infos de la vidéo | Formulaire dynamique de personnalisation | **locale** | — |
| 07 | Récapitulatif et confirmation | Vérification des informations | **locale** | — |
| 08 | Caméra guidée | Enregistrement des scènes | **locale** | — |
| 09 | Aperçu des scènes filmées | Vérification des prises | **locale** | — |
| 10 | Montage automatique | Assemblage local de la publicité | **locale** | — |
| 11 | Vidéo finale | Enregistrement et partage | locale (fichier) | `POST /v1/exports/authorize` + `Idempotency-Key` |
| 12 | Tableau de bord | Solde, pass et offres | serveur | `GET /v1/terminals/me` · `GET /v1/plans` |
| 13 | Paiement Mobile Money | Paiement avec CinetPay | serveur | `POST /v1/payments/initiate` |
| 14 | Contacter le support | Support via WhatsApp | locale | — (aucune API) |

## Détail écran par écran

### 01 — Choix de la langue
Français ou English. Géré dans Android. Aucune API de traduction, aucune
donnée de compte.

### 02 — Accueil / Bienvenue
Textes, images, animations et vidéos de présentation gérés localement.
Aucune API.

### 03 — Chargement / Initialisation
Raccordement initial avec le serveur : l'application appelle
`POST /v1/terminals/bootstrap` (en-tête `X-Device-Id` = ANDROID_ID).
Le serveur identifie le terminal (HMAC-SHA256 côté serveur), vérifie
s'il existe déjà, accorde **3 crédits gratuits uniquement à un nouveau
terminal** (atomiquement — deux appels simultanés ne doublent jamais) et
retourne le **solde réel**. Lors des ouvertures suivantes, le même
terminal retrouve son état **sans nouveaux crédits** ; une
réinstallation ne réattribue jamais les 3 crédits. L'application ne doit
jamais réattribuer elle-même les crédits.

### 04 — Choix du secteur
Sélection locale parmi les quatre secteurs officiels :
1. Restaurants & Maquis (`restaurants_maquis`)
2. Coiffure & Beauté (`coiffure_beaute`)
3. Vêtements & Mode (`vetements_mode`)
4. Commerce & Petites entreprises (`shops_small_business`)

Aucun secteur supplémentaire. Pas d'API.

### 05 — Catalogue de gabarits
Exactement cinq gabarits par secteur (vingt au total). Les gabarits sont
des **ressources Android** : le serveur ne les crée pas, ne les héberge
pas, ne les stocke pas. Pas d'API de catalogue graphique.

### 06 — Infos de la vidéo
Formulaire dynamique : nom du commerce, plat ou produit mis en avant,
prix affiché, numéro WhatsApp, localisation, accroche facultative.
**Ces informations restent exclusivement sur le téléphone.** Aucune
table D1, aucune API de formulaire. Ne pas confondre le prix d'un
produit affiché dans une publicité avec le prix d'un pass VITRINE VIDÉO.

### 07 — Récapitulatif et confirmation
Présentation des informations saisies. Tout reste local. Aucune donnée
envoyée au serveur.

### 08 — Caméra guidée
Enregistrement des scènes sur Android. **Aucun fichier vidéo transmis au
Worker.**

### 09 — Aperçu des scènes filmées
Aperçu et vérification locaux. Aucun upload, aucune conservation serveur.

### 10 — Montage automatique
Montage, transitions, textes, musique et rendu **sur le téléphone**. Le
serveur ne réalise aucun montage, n'héberge aucun service de rendu, ne
stocke aucune vidéo.

### 11 — Vidéo finale
La vidéo publicitaire finalisée est présentée avec deux actions :
**Enregistrer** et **Partager sur WhatsApp**. Ces deux actions
concernent une seule et même publicité : **une publicité finalisée = un
seul crédit consommé**.

- Le montage local doit être **terminé** avant la première demande
  d'autorisation.
- Première demande (enregistrement OU partage) :
  `POST /v1/exports/authorize` avec l'en-tête `Idempotency-Key` (clé
  unique générée pour cette publicité, conservée avec elle).
  - `201` → crédit débité, `authorization.id` renvoyé ;
  - `402 INSUFFICIENT_CREDITS` → offres renvoyées (`error.details.plans`)
    pour l'écran 12/13 ;
  - `429` → réessai avec backoff.
- Action suivante (partage après enregistrement, ou inversement) :
  **rejeu de la même `Idempotency-Key`** → `200 replay`, même
  `authorization.id`, **aucun second débit** (prouvé y compris en
  concurrence).
- Le fichier vidéo ne quitte jamais le téléphone.

### 12 — Tableau de bord
Présente : solde total, crédits gratuits restants, crédits payants
restants, pass actif, date et heure d'expiration, offres commerciales,
bouton de création d'une vidéo. Données :
`GET /v1/terminals/me` (solde, lots, pass actifs avec `expires_at`,
`server_utc_now` pour la dérive d'horloge) et `GET /v1/plans`
(catalogue). **Les crédits affichés viennent toujours du serveur**,
jamais d'un calcul local.

### 13 — Paiement Mobile Money
`POST /v1/payments/initiate { product_code }` — l'application transmet
uniquement le produit choisi ; le serveur fixe lui-même le prix, les
crédits et la durée. La confirmation passe par le mécanisme officiel
CinetPay (webhook serveur + vérification serveur-à-serveur) ; un retour
navigateur n'est jamais une preuve. Les moyens de paiement affichés
doivent correspondre aux méthodes **réellement proposées par CinetPay**
dans la configuration disponible — ne pas prétendre qu'une méthode
Mobile Money fonctionne si elle n'a pas été testée. Après retour,
l'UI rafraîchit via `GET /v1/terminals/me`.

### 14 — Contacter le support
Le support s'ouvre via WhatsApp. Aucun système de ticket, aucune table
support, aucun compte client, aucune API de messagerie.

## Règles UI à respecter (miroir du contrat serveur)

1. Toujours envoyer `X-Device-Id` (ANDROID_ID) — jamais d'autre
   identifiant, jamais d'e-mail.
2. Une `Idempotency-Key` par publicité, générée à la création de la
   publicité et conservée dans le brouillon local ; jamais réutilisée
   entre deux publicités différentes.
3. Ne jamais afficher un paiement simulé comme réel (réponses
   `simulation: true` / `simulated: true` en staging).
4. Aucune donnée des écrans 04 à 10 ne quitte le téléphone.
5. Les crédits affichés viennent toujours du serveur (`/v1/terminals/me`),
   lui seul connaît les expirations.
6. Aucun montant, aucun nombre de crédits, aucune durée n'est jamais
   envoyé au serveur pour un paiement — uniquement `product_code`.
