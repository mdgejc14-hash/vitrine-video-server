#!/usr/bin/env bash
# ============================================================================
# VITRINE VIDEO LITE — provisionnement Cloudflare (staging puis production)
# ============================================================================
# CRÉE uniquement les ressources NOUVELLES du projet :
#   - D1 vitrine-video-lite-staging-db
#   - D1 vitrine-video-lite-production-db
#   - secrets applicatifs générés cryptographiquement (openssl) — étape
#     séparée (--secrets) à exécuter APRÈS le premier `wrangler deploy`
#     (un secret ne peut être posé que sur un Worker existant) :
#       DEVICE_ID_HMAC_SECRET, ADMIN_METRICS_TOKEN, SIMULATION_SECRET (staging)
#
# NE TOUCHE JAMAIS aux ressources existantes (ancien worker
# vitrine-video-api, anciennes D1, bucket B2 vitrine-video-media…).
# AUCUNE suppression, AUCUN vidage, AUCUNE clé fabriquée à la main.
#
# Idempotent : une base existante est réutilisée telle quelle (jamais
# recréée) ; un secret déjà positionné n'est pas écrasé sans --force-secrets.
#
# Inventaire D1 via l'API REST officielle (forme de réponse éprouvée) ;
# commandes wrangler SANS --account-id (supprimé de wrangler 4 : le compte
# vient de la variable d'environnement CLOUDFLARE_ACCOUNT_ID).
#
# Prérequis : CLOUDFLARE_API_TOKEN (compte d7dac13da931423a19812f6d9116bd47)
# dans l'environnement. Sans token → mode inspection seule (--dry-run).
#
# Usage :
#   scripts/provision.sh --dry-run       # inventaire, aucune écriture
#   scripts/provision.sh                 # D1 + migrations (aucun secret)
#   scripts/provision.sh --secrets       # secrets seuls (Worker déjà déployé)
#   scripts/provision.sh --force-secrets # idem, écrase les secrets existants
#   scripts/provision.sh --apply-config  # en plus : injecte les database_id
#                                        # dans wrangler.jsonc (plus utile :
#                                        # les identifiants réels sont committés)
#   scripts/provision.sh --only staging     # ne touche QUE le staging
#   scripts/provision.sh --only production  # ne touche QUE la production
#   (défaut : les deux)
# ============================================================================
set -euo pipefail

DRY_RUN=0
APPLY_CONFIG=0
FORCE_SECRETS=0
SECRETS_ONLY=0
ONLY="both"
prev=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)       DRY_RUN=1 ;;
    --apply-config)  APPLY_CONFIG=1 ;;
    --force-secrets) FORCE_SECRETS=1 ;;
    --secrets)       SECRETS_ONLY=1 ;;
    --only)          prev="only" ;;
    staging|production|both) [[ "$prev" == "only" ]] && ONLY="$arg"; prev="" ;;
    *) echo "Argument inconnu : $arg" >&2; exit 2 ;;
  esac
done
do_staging()    { [[ "$ONLY" == "both" || "$ONLY" == "staging" ]]; }
do_production() { [[ "$ONLY" == "both" || "$ONLY" == "production" ]]; }

CF_ACCOUNT="d7dac13da931423a19812f6d9116bd47"
STAGING_DB="vitrine-video-lite-staging-db"
PRODUCTION_DB="vitrine-video-lite-production-db"
STAGING_WORKER="vitrine-video-lite-api-staging"
PRODUCTION_WORKER="vitrine-video-lite-api"

# wrangler 4 : le compte vient de l'environnement (le drapeau
# --account-id a été supprimé et provoquerait « Unknown arguments »).
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$CF_ACCOUNT}"

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  HAVE_TOKEN=1
else
  HAVE_TOKEN=0
  echo "!! CLOUDFLARE_API_TOKEN absent — mode inspection locale uniquement." >&2
  if [[ $DRY_RUN -eq 0 ]]; then
    echo "   (Aucune écriture possible sans token ; relancez avec --dry-run" >&2
    echo "    pour un inventaire, ou fournissez le token.)" >&2
    exit 3
  fi
fi

# ---------------------------------------------------------------------------
# API REST officielle (forme de réponse : {"success":…, "result": […]}).
# ---------------------------------------------------------------------------
api() { # méthode chemin [corps JSON]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -s -X "$method" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      "https://api.cloudflare.com/client/v4$path" -d "$body"
  else
    curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      "https://api.cloudflare.com/client/v4$path"
  fi
}

# Cache local de l'inventaire D1 (fichier + heredoc : aucun souci de
# citation, portable sur tout Python 3).
D1_CACHE="$(mktemp)"
trap 'rm -f "$D1_CACHE"' EXIT

fetch_d1_list() {
  if [[ $HAVE_TOKEN -eq 1 ]]; then
    api GET "/accounts/$CF_ACCOUNT/d1/database?per_page=100" > "$D1_CACHE"
  else
    echo '{"result":[]}' > "$D1_CACHE"
  fi
}

d1_uuid_of() { # $1 = nom de base → uuid sur stdout (vide si absente)
  python3 - "$D1_CACHE" "$1" <<'PYEOF'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for d in data.get("result", []):
    if d.get("name") == sys.argv[2]:
        print(d.get("uuid", ""))
        break
PYEOF
}

# ---------------------------------------------------------------------------
# 1. Inventaire des bases D1 (lecture seule)
# ---------------------------------------------------------------------------
echo "== Bases D1 du compte =="
fetch_d1_list
python3 - "$D1_CACHE" <<'PYEOF'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    for d in data.get("result", []):
        print(f"  - {d.get('name')}  ({d.get('uuid')})")
except Exception as e:
    print(f"  (inventaire illisible : {e})")
PYEOF

# ---------------------------------------------------------------------------
# 2. Secrets applicatifs (étape séparée, APRÈS le premier déploiement).
#    Un secret fourni par l'environnement (CI) est réutilisé tel quel ;
#    sinon génération cryptographique. Les valeurs ne sont JAMAIS affichées.
# ---------------------------------------------------------------------------
if [[ $SECRETS_ONLY -eq 1 ]]; then
  if [[ $DRY_RUN -eq 1 || $HAVE_TOKEN -eq 0 ]]; then
    echo "== Secrets : non déposés (dry-run ou token absent)"
    exit 0
  fi
  gen_secret() { openssl rand -hex 32; }
  env_or_gen() { local v; v="${!1:-}"; [[ -n "$v" ]] && printf '%s' "$v" || gen_secret; }
  put_secret() { # worker, nom, valeur
    printf '%s' "$3" | npx wrangler secret put "$2" --name "$1" >/dev/null
  }
  echo "== Génération et dépôt des secrets (valeurs jamais affichées) =="
  [[ $FORCE_SECRETS -eq 1 ]] && echo "   (--force-secrets : écrasement autorisé)"
  if do_staging; then
    put_secret "$STAGING_WORKER"  DEVICE_ID_HMAC_SECRET "$(env_or_gen DEVICE_ID_HMAC_SECRET)"
    put_secret "$STAGING_WORKER"  ADMIN_METRICS_TOKEN   "$(env_or_gen ADMIN_METRICS_TOKEN)"
    put_secret "$STAGING_WORKER"  SIMULATION_SECRET     "$(env_or_gen SIMULATION_SECRET)"
    echo "   staging    : DEVICE_ID_HMAC_SECRET, ADMIN_METRICS_TOKEN, SIMULATION_SECRET"
  fi
  if do_production; then
    put_secret "$PRODUCTION_WORKER" DEVICE_ID_HMAC_SECRET "$(env_or_gen PROD_DEVICE_ID_HMAC_SECRET)"
    put_secret "$PRODUCTION_WORKER" ADMIN_METRICS_TOKEN   "$(env_or_gen PROD_ADMIN_METRICS_TOKEN)"
    # PAS de SIMULATION_SECRET en production : la route de simulation y est
    # désactivée par ENVIRONMENT=production (404 SIMULATION_DISABLED).
    echo "   production : DEVICE_ID_HMAC_SECRET, ADMIN_METRICS_TOKEN (pas de simulation)"
  fi
  echo "== Secrets déposés =="
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Création des bases si absentes (JAMAIS de suppression).
#    Journaux sur stderr, UUID sur stdout (capture propre par l'appelant).
# ---------------------------------------------------------------------------
ensure_db() { # $1 = nom, $2 = étiquette placeholder
  local db="$1" envname="$2" existing uuid
  existing=$(d1_uuid_of "$db")
  if [[ -n "$existing" ]]; then
    echo "== $db existe déjà ($existing) — réutilisée, AUCUNE recréation" >&2
    echo "$existing"
    return 0
  fi
  if [[ $DRY_RUN -eq 1 || $HAVE_TOKEN -eq 0 ]]; then
    echo "== $db ABSENTE — serait créée (aucune action dans ce mode)" >&2
    echo "PENDING_${envname}"
    return 0
  fi
  echo "== Création de $db …" >&2
  api POST "/accounts/$CF_ACCOUNT/d1/database" "{\"name\":\"$db\"}" > "$D1_CACHE"
  uuid=$(python3 - "$D1_CACHE" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    if d.get("success"):
        print((d.get("result") or {}).get("uuid", ""))
    else:
        print("", end="")
        print("ERREUR: " + json.dumps(d.get("errors")), file=sys.stderr)
except Exception:
    pass
PYEOF
)
  if [[ -z "$uuid" ]]; then
    echo "!! Création de $db échouée (uuid introuvable après création)" >&2
    exit 4
  fi
  echo "   créée : $uuid" >&2
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
# 4. Migrations (non destructives, versionnées — idempotentes)
# ---------------------------------------------------------------------------
if [[ $HAVE_TOKEN -eq 1 && $DRY_RUN -eq 0 ]]; then
  if do_staging; then
    echo "== Application des migrations (staging) =="
    npx wrangler d1 migrations apply "$STAGING_DB" --remote
  fi
  if do_production; then
    echo "== Application des migrations (production) =="
    npx wrangler d1 migrations apply "$PRODUCTION_DB" --remote --env production
  fi
else
  echo "== Migrations : non appliquées (dry-run ou token absent)"
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
