# vitrine-video-server

Backend **VITRINE VIDÉO LITE** — Cloudflare Worker + D1. Serveur uniquement
(l'application Android est un dépôt séparé ; frontière absolue).

**Modèle : 1 téléphone = 1 terminal = des crédits.** Aucun compte, aucun
e-mail, aucun parrainage. Le serveur ne stocke ni vidéo, ni gabarit, ni
donnée du formulaire publicitaire (écrans 06-07 : 100 % locaux).

## Démarrage rapide

```bash
npm install
cp .dev.vars.example .dev.vars        # constantes de test non secrètes
npm test                              # 15 scénarios obligatoires (workerd + D1)
npm run dev                           # Worker local (migrations auto)
```

## Documentation

| Document | Rôle |
|---|---|
| `OPENAPI.yaml` | spécification machine de l'API (10 endpoints) |
| `BACKEND_CONTRACT.md` | contrat serveur complet (règles, erreurs, limites) |
| `PRODUCT_UI_REFERENCE.md` | référence 14 écrans ↔ appels serveur/local |
| `CHECKPOINT_SERVER.md` | point de contrôle et référence de reprise |
| `REPORT_SERVER_FINAL.md` | rapport final (verdicts, preuves, blocages) |

## Qualité

```bash
npm run lint        # eslint (0 erreur)
npm run typecheck   # tsc --noEmit (0 erreur)
npm test            # 64 tests : 15 scénarios obligatoires réellement exécutés
```

## Déploiement (CI)

- **A — qualité** : chaque push/PR (lint + types + 15 scénarios).
- **B — staging** : provision D1 staging + déploiement + E2E réseau
  (`scripts/e2e-runner.sh staging`, 15 scénarios HTTP).
- **C — production** : manuel, confirmation « DEPLOYER », paiements
  **désactivés** (PAYMENT_MODE=disabled), garde de configuration.
- **D — checkpoint** : hebdomadaire, artefact d'état (jamais de push).

Prérequis distant : secret `CLOUDFLARE_API_TOKEN` (Actions). Aucun secret
n'est committé ; les secrets applicatifs sont générés et déposés par
`scripts/provision.sh` (openssl/python `secrets`).

## Règles métier essentielles

- Bootstrap : **3 crédits gratuits une seule fois** ; réinstallation ≠
  réattribution.
- **Une publicité = un crédit** : enregistrer puis partager sur WhatsApp =
  la même autorisation (même `Idempotency-Key`).
- Expiration stricte `now < expires_at` ; débit : lot payant expirant le
  plus tôt d'abord, gratuits préservés.
- Paiements : montant/crédits/durée fixés par le serveur ; la notification
  CinetPay n'est jamais une preuve (vérification `/v2/payment/check`) ;
  idempotence totale (jamais de double crédit).
- Simulation : staging uniquement (`/__test__/payments/settle`, secret),
  inexistante en production.
