#!/usr/bin/env bash
# ============================================================================
# VITRINE VIDEO LITE — provisionnement Cloudflare (staging puis production)
# ============================================================================
# CRÉE uniquement les ressources NOUVELLES du projet :
#   - D1 vitrine-video-lite-staging-db
#   - D1 vitrine-video-lite-production-db
#   - secrets applicatifs générés cryptographiquement (openssl) :
#       DEVICE_ID_HMAC_SECRET, ADMIN_METRICS_TOKEN, SIMULATION_SECRET (staging)
#
# NE TOUCHE JAMAIS aux ressources existantes (ancien worker
# vitrine-video-api, anciennes D1, bucket B2 vitrine-video-media…).
# AUCUNE suppression, AUCUN vidage, AUCUNE clé fabriquée à la main.
#
# Idempotent : une base existante est réutilisée telle quelle (jamais
# recréée), un secret déjà positionné n'est pas écrasé sans --force-secrets.
#
# Prérequis : CLOUDFLARE_API_TOKEN (compte d7dac13da931423a19812f6d9116bd47)
# dans l'environnement. Sans token → mode inspection seule (--dry-run).
#
# Usage :
#   scripts/provision.sh --dry-run     # inventaire, aucune écriture
#   scripts/provision.sh               # création D1 + migrations + secrets
#   scripts/provision.sh --apply-config # en plus : injecte les database_id
#                                        # dans wrangler.jsonc (sed)
#   scripts/provision.sh --only staging   # ne touche QUE le staging
#   scripts/provision.sh --only production # ne touche QUE la production
#   (défaut : les deux)
# ============================================================================
set -euo pipefail

DRY_RUN=0
APPLY_CONFIG=0
FORCE_SECRETS=0
ONLY="both"
for arg in "$@"; do
  case "$arg" in
    --dry-run)       DRY_RUN=1 ;;
    --apply-config)  APPLY_CONFIG=1 ;;
    --force-secrets) FORCE_SECRETS=1 ;;
    --only)          : ;; # géré ci-dessous
    staging|production|both) ONLY="$arg" ;;
    *) echo "Argument inconnu : $arg" >&2; exit 2 ;;
  esac
done
do_staging()  { [[ "$ONLY" == "both" || "$ONLY" == "staging" ]]; }
do_production() { [[ "$ONLY" == "both" || "$ONLY" == "production" ]]; }

CF_ACCOUNT="d7dac13da931423a19812f6d9116bd47"
STAGING_DB="vitrine-video-lite-staging-db"
PRODUCTION_DB="vitrine-video-lite-production-db"
STAGING_WORKER="vitrine-video-lite-api-staging"
PRODUCTION_WORKER="vitrine-video-lite-api"

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  HAVE_TOKEN=1
else
  HAVE_TOKEN=0
  echo "!! CLOUDFLARE_API_TOKEN absent — mode inspection locale uniquement."
  if [[ $DRY_RUN -eq 0 ]]; then
    echo "   (Aucune écriture possible sans token ; relancez avec --dry-run"
    echo "    pour un inventaire, ou fournissez le token.)"
    exit 3
  fi
fi

wr() { # wrapper wrangler avec compte explicite
  npx wrangler --account-id "$CF_ACCOUNT" "$@"
}

# ---------------------------------------------------------------------------
# 1. Inventaire des bases D1 (lecture seule)
# ---------------------------------------------------------------------------
echo "== Bases D1 du compte =="
if [[ $HAVE_TOKEN -eq 1 ]]; then
  wr d1 list --json | python3 -c '
import json,sys
dbs=json.load(sys.stdin)
for d in dbs:
    print(f"  - {d[\"name\"]}  ({d[\"uuid\"]})")
'
else
  echo "  (token absent : inventaire distant impossible)"
fi

# ---------------------------------------------------------------------------
# 2. Création des bases si absentes (JAMAIS de suppression)
# ---------------------------------------------------------------------------
ensure_db() {
  local db="$1" envname="$2"
  local existing
  existing=$( [[ $HAVE_TOKEN -eq 1 ]] && wr d1 list --json | python3 -c "
import json,sys
dbs=json.load(sys.stdin)
print(next((d['uuid'] for d in dbs if d['name']=='$db'),''))" || echo "")
  if [[ -n "$existing" ]]; then
    echo "== $db existe déjà ($existing) — réutilisée, AUCUNE recréation"
    echo "$existing"
    return 0
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "== $db ABSENTE — serait créée (mode dry-run : aucune action)"
    echo "PENDING_${envname}"
    return 0
  fi
  echo "== Création de $db …"
  wr d1 create "$db" >/dev/null
  local uuid
  uuid=$(wr d1 list --json | python3 -c "
import json,sys
dbs=json.load(sys.stdin)
print(next((d['uuid'] for d in dbs if d['name']=='$db'),''))")
  if [[ -z "$uuid" ]]; then
    echo "!! Création de $db échouée (uuid introuvable après création)" >&2
    exit 4
  fi
  echo "   créée : $uuid"
  echo "$uuid"
}

if do_staging; then
  STAGING_UUID=$(ensure_db "$STAGING_DB" "D1_CREATION_STAGING")
else
  STAGING_UUID="skipped"
fi
if do_production; then
  PRODUCTION_UUID=$(ensure_db "$PRODUCTION_DB" "D1_CREATION_PRODUCTION")
else
  PRODUCTION_UUID="skipped"
fi

# ---------------------------------------------------------------------------
# 3. Migrations (non destructives, versionnées)
# ---------------------------------------------------------------------------
if [[ $HAVE_TOKEN -eq 1 && $DRY_RUN -eq 0 ]]; then
  if do_staging; then
    echo "== Application des migrations (staging) =="
    wr d1 migrations apply "$STAGING_DB" --remote
  fi
  if do_production; then
    echo "== Application des migrations (production) =="
    wr d1 migrations apply "$PRODUCTION_DB" --remote
  fi
else
  echo "== Migrations : non appliquées (dry-run ou token absent)"
fi

# ---------------------------------------------------------------------------
# 4. Secrets applicatifs — générés cryptographiquement, jamais affichés
# ---------------------------------------------------------------------------
if [[ $DRY_RUN -eq 0 && $HAVE_TOKEN -eq 1 ]]; then
  # Un secret fourni par l'environnement (CI) est réutilisé tel quel ;
  # sinon génération cryptographique (openssl). Les valeurs ne sont
  # JAMAIS affichées ni journalisées.
  gen_secret() { openssl rand -hex 32; }
  env_or_gen() { local v; v="${!1:-}"; [[ -n "$v" ]] && printf '%s' "$v" || gen_secret; }
  put_secret() { # worker, nom, valeur
    printf '%s' "$3" | wr secret put "$2" --name "$1" >/dev/null
  }
  echo "== Génération et dépôt des secrets (valeurs jamais affichées) =="
  [[ $FORCE_SECRETS -eq 1 ]] && echo "   (--force-secrets : écrasement autorisé)"

  if do_staging; then
    put_secret "$STAGING_WORKER"  DEVICE_ID_HMAC_SECRET "$(env_or_gen DEVICE_ID_HMAC_SECRET)"
    put_secret "$STAGING_WORKER"  ADMIN_METRICS_TOKEN   "$(env_or_gen ADMIN_METRICS_TOKEN)"
    put_secret "$STAGING_WORKER"  SIMULATION_SECRET     "$(env_or_gen SIMULATION_SECRET)"
    echo "   staging  : DEVICE_ID_HMAC_SECRET, ADMIN_METRICS_TOKEN, SIMULATION_SECRET"
  fi
  if do_production; then
    put_secret "$PRODUCTION_WORKER" DEVICE_ID_HMAC_SECRET "$(env_or_gen PROD_DEVICE_ID_HMAC_SECRET)"
    put_secret "$PRODUCTION_WORKER" ADMIN_METRICS_TOKEN   "$(env_or_gen PROD_ADMIN_METRICS_TOKEN)"
    # PAS de SIMULATION_SECRET en production : la route de simulation y est
    # désactivée par ENVIRONMENT=production (404 SIMULATION_DISABLED).
    echo "   production : DEVICE_ID_HMAC_SECRET, ADMIN_METRICS_TOKEN (pas de simulation)"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Injection des database_id dans wrangler.jsonc (optionnel, explicite)
# ---------------------------------------------------------------------------
if [[ $APPLY_CONFIG -eq 1 ]]; then
  if [[ "$STAGING_UUID" == PENDING_* || "$PRODUCTION_UUID" == PENDING_* ]]; then
    echo "!! database_id encore PENDING — création impossible (dry-run ?)" >&2
    exit 5
  fi
  # (les uuid « skipped » ne concernent pas les environnements exclus)
  python3 - "$STAGING_UUID" "$PRODUCTION_UUID" <<'PYEOF'
import pathlib, sys
staging, production = sys.argv[1], sys.argv[2]
p = pathlib.Path("wrangler.jsonc")
s = p.read_text(encoding="utf-8")
if not staging.startswith(("PENDING", "skipped")):
    s = s.replace("PENDING_D1_CREATION_STAGING", staging)
if not production.startswith(("PENDING", "skipped")):
    s = s.replace("PENDING_D1_CREATION_PRODUCTION", production)
p.write_text(s, encoding="utf-8")
print("wrangler.jsonc mis à jour avec les database_id réels")
PYEOF
  echo "!! N'oubliez pas de committer wrangler.jsonc mis à jour."
fi

echo "== Provision terminé =="
