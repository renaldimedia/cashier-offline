# POS App — Offline First Architecture

## Stack
| Layer | Tech |
|---|---|
| Desktop Shell | Tauri v2 |
| Backend Logic | Rust |
| Database | SQLite via rusqlite |
| Frontend | React 18 + Vite + Tailwind CSS |
| Logging | tracing + tracing-appender |
| HTTP Client (sync) | reqwest |
| Auth (sync) | JWT via jsonwebtoken |

---

## Directory Structure
```
pos-app/
├── src-tauri/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs              # Tauri entry point
│       ├── lib.rs               # App state + command registration
│       ├── db/
│       │   ├── mod.rs           # DB manager (master + transactional)
│       │   ├── master.rs        # Master DB connection + migrations
│       │   ├── transactional.rs # Transactional DB (monthly versioning)
│       │   └── migrations/
│       │       ├── master/
│       │       │   └── V1__init.sql
│       │       └── transactional/
│       │           └── V1__init.sql
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── auth.rs
│       │   ├── products.rs
│       │   ├── categories.rs
│       │   ├── customers.rs
│       │   ├── transactions.rs
│       │   ├── settings.rs
│       │   └── sync.rs
│       ├── sync/
│       │   ├── mod.rs
│       │   ├── engine.rs        # Sync runner (inbound/outbound)
│       │   └── mapper.rs        # Field mapping: api → local
│       ├── auth/
│       │   └── mod.rs           # Session management, role guard
│       └── logger/
│           └── mod.rs           # File logger setup
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── layout/
│   │   ├── ui/                  # Minimal reusable UI primitives
│   │   └── shared/
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── POS.tsx              # Cashier screen
│   │   ├── Products.tsx
│   │   ├── Transactions.tsx
│   │   ├── Reports.tsx
│   │   ├── Settings.tsx
│   │   └── Sync.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useProducts.ts
│   │   └── useSync.ts
│   ├── store/
│   │   ├── authStore.ts         # Zustand
│   │   ├── cartStore.ts
│   │   └── syncStore.ts
│   └── lib/
│       └── tauri.ts             # Tauri invoke wrappers
│
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## Database Design

### File Locations (AppData)
```
{AppData}/pos-app/
├── db/
│   ├── master.db                          # Master data
│   └── transactions/
│       ├── transactions_2025_01.db
│       ├── transactions_2025_02.db
│       └── transactions_YYYY_MM.db        # Current month (auto-created)
└── logs/
    ├── app_2025-01.log
    └── app_2025-02.log
```

### Master DB Schema

```sql
-- users
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,          -- bcrypt hash
  role        TEXT NOT NULL CHECK(role IN ('superadmin','manager','cashier')),
  full_name   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- categories
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  ext_id      TEXT,                   -- external API id (for sync)
  synced_at   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- products
CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  price       REAL NOT NULL,
  cost        REAL,
  stock       INTEGER NOT NULL DEFAULT 0,
  unit        TEXT DEFAULT 'pcs',
  barcode     TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  ext_id      TEXT,
  synced_at   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- customers
CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  ext_id      TEXT,
  synced_at   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- settings
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TEXT NOT NULL
);

-- sync_sources  (configurable sync endpoints)
CREATE TABLE sync_sources (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  entity_type     TEXT NOT NULL,     -- 'products','categories','customers','transactions'
  base_url        TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  api_key         TEXT,              -- encrypted
  auth_type       TEXT DEFAULT 'apikey' CHECK(auth_type IN ('apikey','jwt','none')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_sync_at    TEXT,
  sync_interval   INTEGER DEFAULT 3600,  -- seconds
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- sync_field_mappings  (api field → local field)
CREATE TABLE sync_field_mappings (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sync_sources(id) ON DELETE CASCADE,
  api_field     TEXT NOT NULL,       -- e.g. "product_name"
  local_field   TEXT NOT NULL,       -- e.g. "name"
  transform     TEXT,                -- optional: "uppercase", "trim", custom
  is_required   INTEGER DEFAULT 0,
  default_value TEXT
);
```

### Transactional DB Schema (per month)

```sql
-- transactions
CREATE TABLE transactions (
  id              TEXT PRIMARY KEY,
  invoice_no      TEXT UNIQUE NOT NULL,
  cashier_id      TEXT NOT NULL,
  customer_id     TEXT,
  subtotal        REAL NOT NULL,
  discount        REAL NOT NULL DEFAULT 0,
  tax             REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('completed','void','pending')),
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- transaction_items
CREATE TABLE transaction_items (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL,
  product_name    TEXT NOT NULL,     -- snapshot at time of sale
  product_sku     TEXT NOT NULL,
  qty             INTEGER NOT NULL,
  unit_price      REAL NOT NULL,
  discount        REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL
);

-- payments
CREATE TABLE payments (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  method          TEXT NOT NULL CHECK(method IN ('cash','card','qris','transfer')),
  amount          REAL NOT NULL,
  change_amount   REAL NOT NULL DEFAULT 0,
  reference_no    TEXT,
  created_at      TEXT NOT NULL
);

-- sync_queue  (outbound: app → api)
CREATE TABLE sync_queue (
  id              TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  payload         TEXT NOT NULL,     -- JSON
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','syncing','done','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  synced_at       TEXT
);
```

---

## User Roles & Permissions

| Feature | superadmin | manager | cashier |
|---|---|---|---|
| POS / Checkout | ✓ | ✓ | ✓ |
| View Reports | ✓ | ✓ | – |
| Manage Products | ✓ | ✓ | – |
| Manage Users | ✓ | – | – |
| Configure Sync | ✓ | – | – |
| View Settings | ✓ | ✓ | – |
| Edit Settings | ✓ | – | – |
| Void Transaction | ✓ | ✓ | – |

---

## Sync Architecture

### Inbound (Master: API → App)
```
Scheduler / Manual Trigger
  → fetch API endpoint (with apikey/JWT)
  → apply field mappings
  → upsert into master.db (by ext_id)
  → update last_sync_at
```

### Outbound (Transactional: App → API)
```
Transaction completed
  → serialize to JSON
  → insert into sync_queue (status=pending)
  → background worker picks up pending items
  → POST to configured endpoint
  → update status: done / failed (retry up to 3x)
```

---

## Development Phases

### Phase 1 — Project Setup & DB ✅
- [ ] Tauri v2 project scaffold
- [ ] Cargo.toml dependencies
- [ ] DB module (master + transactional)
- [ ] Migration files
- [ ] Logger setup
- [ ] AppState

### Phase 2 — Rust Backend Commands
- [ ] Auth commands (login, session)
- [ ] Product CRUD commands
- [ ] Transaction commands
- [ ] Settings commands
- [ ] Sync source CRUD

### Phase 3 — React Frontend
- [ ] Auth / Login page
- [ ] Layout + routing
- [ ] POS screen (cart, checkout)
- [ ] Product management
- [ ] Transaction history
- [ ] Settings + Sync config

### Phase 4 — Sync Engine
- [ ] Sync engine (inbound + outbound)
- [ ] Field mapper
- [ ] Background scheduler
- [ ] Sync status UI