-- =====================================================================
-- VITRINE VIDEO LITE — migration initiale (D1 / SQLite)
-- Schéma minimal et STRICT : uniquement les tables autorisées par la
-- mission. Aucune table interdite (comptes, promotions, parrainage,
-- vidéos, gabarits, scènes, montages) n'existe ici.
--
-- Convention temporelle : toutes les dates sont stockées en TEXT ISO-8601
-- UTC avec millisecondes ("2026-11-17T10:00:00.000Z") — comparaison
-- lexicographique fiable ; l'horloge de référence est l'UTC du Worker.
-- Règle d'expiration officielle : un lot est valide si now < expires_at.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TERMINAUX (identification pseudonymisée)
-- device_hash = HMAC-SHA256(DEVICE_ID_HMAC_SECRET, android_id normalisé)
-- L'ANDROID_ID brut n'est JAMAIS stocké (contrainte de conception).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terminals (
  id               TEXT PRIMARY KEY,
  device_hash      TEXT NOT NULL UNIQUE,
  hash_key_version INTEGER NOT NULL DEFAULT 1,
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  app_version      TEXT,
  platform         TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'blocked')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- 2. LOTS DE CRÉDITS (crédits gratuits + crédits des pass)
-- Chaque achat confirmé crée un lot INDÉPENDANT avec sa propre
-- expiration. grant_type : 'free_install' (3 crédits, sans expiration)
-- ou 'pass' (issu d'un paiement confirmé).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_grants (
  id                TEXT PRIMARY KEY,
  terminal_id       TEXT NOT NULL REFERENCES terminals(id),
  grant_type        TEXT NOT NULL
                      CHECK (grant_type IN ('free_install', 'pass')),
  product_code      TEXT NOT NULL
                      CHECK (product_code IN
                        ('FREE_INSTALL', 'PASS_EXPRESS', 'PASS_PRO', 'PASS_BOUTIQUE')),
  credits_total     INTEGER NOT NULL CHECK (credits_total > 0),
  credits_remaining INTEGER NOT NULL
                      CHECK (credits_remaining >= 0 AND credits_remaining <= credits_total),
  starts_at         TEXT NOT NULL,
  expires_at        TEXT,               -- NULL = n'expire jamais (crédits gratuits)
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'exhausted', 'expired', 'revoked')),
  payment_id        TEXT REFERENCES payments(id),
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_grants_terminal
  ON credit_grants (terminal_id, status, expires_at);

-- ---------------------------------------------------------------------
-- 3. PAIEMENTS
-- merchant_transaction_id : référence marchande UNIQUE générée par le
-- serveur (jamais choisie par le client).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                       TEXT PRIMARY KEY,
  terminal_id              TEXT NOT NULL REFERENCES terminals(id),
  provider                 TEXT NOT NULL DEFAULT 'cinetpay',
  product_code             TEXT NOT NULL
                             CHECK (product_code IN
                               ('PASS_EXPRESS', 'PASS_PRO', 'PASS_BOUTIQUE')),
  merchant_transaction_id  TEXT NOT NULL UNIQUE,
  provider_transaction_id  TEXT UNIQUE,
  amount                   INTEGER NOT NULL CHECK (amount > 0),
  currency                 TEXT NOT NULL DEFAULT 'XOF',
  payment_status           TEXT NOT NULL
                             CHECK (payment_status IN
                               ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  provider_reference       TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  confirmed_at             TEXT,
  expires_at               TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_terminal
  ON payments (terminal_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_status
  ON payments (payment_status, product_code);

-- ---------------------------------------------------------------------
-- 4. AUTORISATIONS D'EXPORT
-- Une publicité finalisée = UNE autorisation = UN crédit.
-- UNIQUE(terminal_id, idempotency_key) : la même clé (générée par
-- l'application pour une même publicité) retrouve TOUJOURS
-- l'autorisation initiale — enregistrer puis partager ne débite qu'une
-- fois.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS export_authorizations (
  id               TEXT PRIMARY KEY,
  terminal_id      TEXT NOT NULL REFERENCES terminals(id),
  grant_id         TEXT NOT NULL REFERENCES credit_grants(id),
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'revoked')),
  authorized_at    TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  UNIQUE (terminal_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_export_auths_terminal
  ON export_authorizations (terminal_id, created_at);

-- ---------------------------------------------------------------------
-- 5. ÉVÉNEMENTS WEBHOOK FOURNISSEUR
-- Journal + idempotence des notifications CinetPay. event_reference
-- unique par fournisseur quand il est disponible (protection rejeu).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id                       TEXT PRIMARY KEY,
  provider                 TEXT NOT NULL DEFAULT 'cinetpay',
  event_reference          TEXT,
  merchant_transaction_id  TEXT,
  status                   TEXT NOT NULL
                             CHECK (status IN ('RECEIVED', 'PROCESSED', 'REJECTED', 'DUPLICATE')),
  received_at              TEXT NOT NULL,
  processed_at             TEXT,
  error_code               TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_events_ref
  ON payment_webhook_events (provider, event_reference)
  WHERE event_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_mtid
  ON payment_webhook_events (merchant_transaction_id);

-- ---------------------------------------------------------------------
-- 6. ÉVÉNEMENTS TERMINAL (télémétrie non sensible)
-- métadonnées : JSON TEXT non sensible (jamais de contenu du formulaire
-- publicitaire, jamais d'ANDROID_ID, jamais de numéro WhatsApp).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_events (
  id           TEXT PRIMARY KEY,
  terminal_id  TEXT NOT NULL REFERENCES terminals(id),
  event_type   TEXT NOT NULL
                 CHECK (event_type IN (
                   'terminal_created', 'terminal_seen',
                   'export_authorized', 'export_replayed',
                   'payment_initiated', 'payment_confirmed',
                   'payment_rejected', 'grant_created')),
  occurred_at  TEXT NOT NULL,
  metadata     TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_device_events_terminal
  ON device_events (terminal_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_device_events_type
  ON device_events (event_type, occurred_at);

-- ---------------------------------------------------------------------
-- 7. COMPTEURS DE RATE LIMITING (fenêtre fixe, clé = classe de route +
-- identifiant pseudonyme ou IP). Table technique — aucune donnée
-- personnelle : la clé utilise le device_hash tronqué ou l'IP.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key           TEXT PRIMARY KEY,
  window_start  TEXT NOT NULL,
  count         INTEGER NOT NULL CHECK (count >= 0)
);
