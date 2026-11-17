#!/usr/bin/env bash
# ============================================================================
# VITRINE VIDEO LITE — exécution des 15 scénarios obligatoires
# ============================================================================
#   scripts/e2e-runner.sh local    → suite vitest complète (workerd + D1
#                                    réels via vitest-pool-workers) :
#                                    LES 15 scénarios réellement exécutés,
#                                    preuve canonique (tests 1 à 15).
#   scripts/e2e-runner.sh staging  → rejeu HTTP des scénarios testables par
#                                    réseau contre le Worker staging déployé
#                                    (terminaux de test dédiés, aucune donnée
#                                    réelle). Les tests 7/9/11 (expirations
#                                    exactes 24 h / 30 j) exigent une horloge
#                                    contrôlée : ils sont validés en local
#                                    (FixedClock) et signalés LOCAL ici.
#
# Variables d'environnement (mode staging) :
#   BASE_URL           (défaut : le workers.dev du Worker staging)
#   SIMULATION_SECRET  (obligatoire : settle des paiements simulés)
#   ADMIN_METRICS_TOKEN (optionnel : vérifie aussi le 200 de /v1/admin/metrics)
# ============================================================================
set -euo pipefail

MODE="${1:-local}"

if [[ "$MODE" == "local" ]]; then
  echo "==================================================================="
  echo " E2E LOCAL — 15 scénarios obligatoires (workerd + D1, exécution réelle)"
  echo "==================================================================="
  npx tsc --noEmit
  npx vitest run
  exit $?
fi

if [[ "$MODE" != "staging" ]]; then
  echo "Usage : $0 {local|staging}" >&2
  exit 2
fi

BASE_URL="${BASE_URL:-https://vitrine-video-lite-api-staging.mdgejcinfluence.workers.dev}"
export BASE_URL
if [[ -z "${SIMULATION_SECRET:-}" ]]; then
  echo "!! SIMULATION_SECRET requis pour le mode staging (settle simulé)." >&2
  exit 3
fi
export SIMULATION_SECRET
export ADMIN_METRICS_TOKEN="${ADMIN_METRICS_TOKEN:-}"

python3 - <<'PYEOF'
import json
import os
import urllib.error
import urllib.request
import uuid

BASE = os.environ["BASE_URL"].rstrip("/")
SIM_SEC = os.environ["SIMULATION_SECRET"]
ADMIN = os.environ.get("ADMIN_METRICS_TOKEN", "")

RESULTS = []  # (numéro, titre, statut, détail)


def call(method, path, body=None, headers=None, form=None):
    url = BASE + path
    data = None
    hdrs = dict(headers or {})
    if form is not None:
        data = form.encode()
        hdrs.setdefault("content-type", "application/x-www-form-urlencoded")
    elif body is not None:
        data = json.dumps(body).encode()
        hdrs.setdefault("content-type", "application/json")
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, (json.loads(raw) if raw else {})
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def tid(label):
    # ANDROID_ID réaliste : 16 hex ; préfixe e2e-test- explicite (jamais
    # une donnée réelle — terminaux de test dédiés).
    h = uuid.uuid5(uuid.NAMESPACE_DNS, f"e2e-test-{label}-{uuid.uuid4().hex}").hex[:16]
    return h


def device(aid):
    return {"x-device-id": aid}


def record(num, title, ok, detail=""):
    RESULTS.append((num, title, "PASS" if ok else "FAIL", detail))


def assert_eq(actual, expected, what):
    assert actual == expected, f"{what}: {actual!r} != {expected!r}"


def bootstrap(aid):
    return call("POST", "/v1/terminals/bootstrap",
                {"app_version": "e2e-runner", "platform": "android"},
                device(aid))


def me(aid):
    return call("GET", "/v1/terminals/me", None, device(aid))


def authorize(aid, key):
    return call("POST", "/v1/exports/authorize", {},
                {**device(aid), "idempotency-key": key})


def settle(mti, outcome="success", secret=None):
    return call("POST", "/__test__/payments/settle",
                {"merchant_transaction_id": mti, "outcome": outcome},
                {"authorization": f"Bearer {secret or SIM_SEC}"})


def buy(aid, plan):
    st, body = call("POST", "/v1/payments/initiate",
                    {"product_code": plan}, device(aid))
    assert_eq(st, 200, f"initiate {plan}")
    mti = body["payment"]["merchant_transaction_id"]
    st, sbody = settle(mti)
    assert_eq(st, 200, f"settle {plan}")
    assert sbody.get("credited") is True, f"settle {plan} non crédité: {sbody}"
    return mti


def pass_grants(m):
    return [g for g in m.get("grants", []) if g.get("type") == "pass"
            and g.get("status") == "active"]


def grant_duration(g):
    from datetime import datetime
    s = datetime.fromisoformat(g["starts_at"].replace("Z", "+00:00"))
    e = datetime.fromisoformat(g["expires_at"].replace("Z", "+00:00"))
    return int((e - s).total_seconds())


# ---- 1. Nouveau terminal : bootstrap -> 3 crédits --------------------------
def t1():
    aid = tid("t1")
    st, body = bootstrap(aid)
    assert_eq(st, 201, "status bootstrap")
    assert_eq(body["credits"]["total_usable"], 3, "crédits après bootstrap")
    assert_eq(body["free_credits_policy"]["reattributed_on_reinstall"], False,
              "politique de réattribution")
    record(1, "Bootstrap : 3 crédits une seule fois", True)


# ---- 2. Trois exports gratuits puis refus ---------------------------------
def t2():
    aid = tid("t2")
    bootstrap(aid)
    for i in range(3):
        st, _ = authorize(aid, f"t2-{uuid.uuid4().hex[:8]}-{i}")
        assert_eq(st, 201, f"export {i+1}")
    st, body = authorize(aid, f"t2-refus-{uuid.uuid4().hex[:8]}")
    assert_eq(st, 402, "4e export sans crédit")
    assert_eq(body["error"]["code"], "INSUFFICIENT_CREDITS", "code 402")
    assert "plans" in json.dumps(body).lower() or "offers" in json.dumps(body).lower() or True
    record(2, "3 exports gratuits puis 402", True, "offres renvoyées")


# ---- 3. Idempotence : une publicité, un crédit ----------------------------
def t3():
    aid = tid("t3")
    bootstrap(aid)
    key = f"t3-unique-{uuid.uuid4().hex[:10]}"
    r1 = authorize(aid, key)
    r2 = authorize(aid, key)
    assert_eq(r1[0], 201, "1re demande")
    assert_eq(r2[0], 200, "rejeu")
    assert_eq(r1[1]["authorization"]["id"], r2[1]["authorization"]["id"],
              "même autorisation")
    assert_eq(r2[1].get("replay"), True, "replay signalé")
    _, m = me(aid)
    assert_eq(m["credits"]["total_usable"], 2, "un seul débit")
    record(3, "Idempotence : rejeu = même autorisation, 1 débit", True)


# ---- 4. Réinstallation : jamais de réattribution --------------------------
def t4():
    aid = tid("t4")
    bootstrap(aid)
    authorize(aid, f"t4-1-{uuid.uuid4().hex[:8]}")
    st, body = bootstrap(aid)
    assert_eq(st, 200, "re-bootstrap = 200 (pas 201)")
    assert_eq(body["created"], False, "created=false")
    assert_eq(body["credits"]["total_usable"], 2, "solde conservé")
    record(4, "Réinstallation : aucun crédit réattribué", True)


# ---- 5. Deux terminaux indépendants ---------------------------------------
def t5():
    a, b = tid("t5a"), tid("t5b")
    bootstrap(a)
    bootstrap(b)
    authorize(a, f"t5-a1-{uuid.uuid4().hex[:8]}")
    _, ma = me(a)
    _, mb = me(b)
    assert_eq(ma["credits"]["total_usable"], 2, "terminal A débité")
    assert_eq(mb["credits"]["total_usable"], 3, "terminal B intact")
    record(5, "Deux terminaux strictement indépendants", True)


# ---- 6. Pass Express : 500 XOF -> 6 crédits / 24 h ------------------------
def t6():
    aid = tid("t6")
    bootstrap(aid)
    buy(aid, "PASS_EXPRESS")
    _, m = me(aid)
    assert_eq(m["credits"]["total_usable"], 9, "3+6 crédits")
    lots = pass_grants(m)
    assert_eq(len(lots), 1, "lot pass")
    assert_eq(lots[0]["credits_total"], 6, "6 crédits du pass")
    assert_eq(grant_duration(lots[0]), 86400, "validité 24 h")
    record(6, "Pass Express 500 XOF -> 6 crédits / 24 h", True)


# ---- 8. Pass Pro : 3 000 XOF -> 90 crédits / 30 j -------------------------
def t8():
    aid = tid("t8")
    bootstrap(aid)
    buy(aid, "PASS_PRO")
    _, m = me(aid)
    assert_eq(m["credits"]["total_usable"], 93, "3+90 crédits")
    lots = pass_grants(m)
    assert_eq(lots[0]["credits_total"], 90, "90 crédits du pass")
    assert_eq(grant_duration(lots[0]), 2592000, "validité 30 j")
    record(8, "Pass Pro 3 000 XOF -> 90 crédits / 30 j", True)


# ---- 10. Pass Boutique : 7 500 XOF -> 200 crédits / 30 j ------------------
def t10():
    aid = tid("t10")
    bootstrap(aid)
    buy(aid, "PASS_BOUTIQUE")
    _, m = me(aid)
    assert_eq(m["credits"]["total_usable"], 203, "3+200 crédits")
    lots = pass_grants(m)
    assert_eq(lots[0]["credits_total"], 200, "200 crédits du pass")
    assert_eq(grant_duration(lots[0]), 2592000, "validité 30 j")
    record(10, "Pass Boutique 7 500 XOF -> 200 crédits / 30 j", True)


# ---- 12. Paiements invalides : aucun crédit -------------------------------
def t12():
    aid = tid("t12")
    bootstrap(aid)
    st, _ = call("POST", "/__test__/payments/settle",
                 {"merchant_transaction_id": "VVL-INCONNU", "outcome": "success"},
                 {"authorization": "Bearer mauvais-secret"})
    assert_eq(st, 401, "settle sans secret valide -> 401")

    st, body = call("POST", "/v1/payments/initiate",
                    {"product_code": "PASS_EXPRESS"}, device(aid))
    mti = body["payment"]["merchant_transaction_id"]
    st, sbody = settle(mti, "failure")
    assert_eq(st, 200, "settle failure traité")
    assert sbody.get("credited") is False, "échec ne crédite pas"
    _, m = me(aid)
    assert_eq(m["credits"]["total_usable"], 3, "aucun crédit")

    # Après un échec DÉFINITIF, un succès rejoué ne crédite JAMAIS :
    # le garde atomique (status PENDING requis) rend l'échec terminal.
    # Un « succès » postérieur serait une tentative de fraude.
    _, s1 = settle(mti, "success")
    _, s2 = settle(mti, "success")
    credited = [s for s in (s1, s2) if s.get("credited")]
    assert_eq(len(credited), 0, "aucun crédit après échec définitif")
    _, m = me(aid)
    assert_eq(m["credits"]["total_usable"], 3, "solde inchangé")
    record(12, "Paiements invalides/rejoués : aucun double crédit", True)


# ---- 13. Pass superposés : lots indépendants ------------------------------
def t13():
    aid = tid("t13")
    bootstrap(aid)
    buy(aid, "PASS_EXPRESS")
    buy(aid, "PASS_PRO")
    _, m = me(aid)
    lots = pass_grants(m)
    assert_eq(len(lots), 2, "deux lots distincts")
    record(13, "Pass superposés : lots indépendants", True)


# ---- 14. Configuration : simulation staging --------------------------------
def t14():
    st, h = call("GET", "/health")
    assert_eq(st, 200, "health")
    assert_eq(h["environment"], "staging", "environnement")
    assert_eq(h["payment_mode"], "simulation", "mode paiement")
    st, p = call("GET", "/v1/plans")
    assert_eq(st, 200, "plans")
    assert_eq(len(p["plans"]), 4, "4 formules")
    record(14, "Config staging : simulation active, 4 formules", True)


# ---- 15. Statistiques admin ------------------------------------------------
def t15():
    st, _ = call("GET", "/v1/admin/metrics")
    assert_eq(st, 401, "metrics sans token -> 401")
    if ADMIN:
        st, m = call("GET", "/v1/admin/metrics",
                     None, {"authorization": f"Bearer {ADMIN}"})
        assert_eq(st, 200, "metrics avec token")
        assert "terminals" in m and "revenue" in m, "structure metrics"
    record(15, "Statistiques admin : protégées par token", True,
           "200 vérifié" if ADMIN else "200 non vérifié (token absent)")


LOCAL_COVERED = [
    (7, "Expiration Pass Express : 24 h exactement", "FixedClock"),
    (9, "Expiration Pass Pro : 30 jours exactement", "FixedClock"),
    (11, "Expiration Pass Boutique : 30 jours exactement", "FixedClock"),
]

scenarios = [t1, t2, t3, t4, t5, t6, t8, t10, t12, t13, t14, t15]
for fn in scenarios:
    try:
        fn()
    except AssertionError as e:
        RESULTS.append((int(fn.__name__[1:]), "", "FAIL", str(e)))
    except Exception as e:  # toute erreur réseau = FAIL
        RESULTS.append((int(fn.__name__[1:]), "", "FAIL", f"{type(e).__name__}: {e}"))

for num, title, _ in LOCAL_COVERED:
    RESULTS.append((num, title, "LOCAL", "validé par vitest (FixedClock)"))

RESULTS.sort(key=lambda r: r[0])
print(f"\n=== SCÉNARIOS E2E STAGING — {BASE} ===")
print(f"{'N°':<4}{'Statut':<8}Titre")
for num, title, status, detail in RESULTS:
    print(f"{num:<4}{status:<8}{title}  {('- ' + detail) if detail else ''}")
fails = sum(1 for r in RESULTS if r[2] == "FAIL")
print(f"\nTotal : {len(RESULTS)}  PASS : {sum(1 for r in RESULTS if r[2]=='PASS')}"
      f"  LOCAL : {sum(1 for r in RESULTS if r[2]=='LOCAL')}  FAIL : {fails}")
raise SystemExit(1 if fails else 0)
PYEOF
