# TIGER OS

G'Day Tiger internal operations dashboard. Built on Next.js, deployed on Vercel, data from Notion + Deputy.

---

## Stack

| Layer | Tool / Version |
|---|---|
| Framework | Next.js 16.2.6 (App Router, TypeScript) |
| UI | React 19.2.4, Tailwind CSS v4 |
| Hosting | Vercel (auto-deploys from `main`) |
| Primary DB | Notion (via REST API) |
| Roster | Deputy API |
| AI | Anthropic API — `claude-opus-4-8` (Projects chat + brain-dump), `claude-haiku-4-5-20251001` (task classify) |
| Automation | Google Apps Script (linked to Food Costings sheet) |
| Fonts | Stolzl (labels), Bodoni PT (headings) |

---

## Deploying

Always deploy via the included script — merges current branch into `main`, pushes, Vercel auto-deploys.

```bash
bash deploy.sh
```

Live in ~30 seconds. To roll back: **vercel.com → your project → Deployments → Promote** any previous deployment.

---

## Layout

Two persistent cards at the top (Daily To Do + Week Ahead), then a **6-tile launcher dock**. Each tile shows a count badge and a red alert dot when something needs attention. Dock resets to all-collapsed on every load. App auto-reloads on day rollover and soft-refreshes on tab refocus.

| Tile | Widget |
|---|---|
| 🛒 Shopping List | Standalone shopping list (own launcher tile) |
| 🎯 Projects | Brain Dump capture + Ongoing Projects |
| 📦 Supplier Prices | Ingredient-level price tracking with 7-day drift |
| ☕ Coffee Costings | Coffee products, sorted worst→best margin |
| 🥪 Food Costings | Food products, sorted worst→best margin |
| 🐯 Tiger OS Updates | In-app changelog + backlog (Notion Backlog DB) |

---

## Dashboard Cards

### ⚡ Daily To Do
Notion day pages. Swipe right = defer to tomorrow; swipe left = delete (one-off only). Recurring undeletable. Drag-drop reorder (desktop). Category labels display below task name. Checked tasks sink to bottom. When shopping items exist, a "Shopping List" link row appears at the bottom — tap to open. All task text displayed uppercase.

**Task prefix system:**

| Prefix | Behaviour |
|---|---|
| `[YYYY-MM-DD]` | One-off — shows only on that date |
| `[F]` | Fortnightly — odd ISO weeks only |
| `[F2]` | Fortnightly — even ISO weeks only |
| `[M]` | Monthly — first 7 days of month |
| `[CARRY]` | Carry-over — re-appears daily until checked |
| *(none)* | Recurring — every week on that day |

**Category order:** ORDER → ADMIN → MAINTENANCE → STAFF → COSTING → MERCHANDISE → PERSONAL

### 🛒 Shopping List
Standalone launcher tile. Sourced from dedicated Shopping List Notion page (`3683c99c0e8581c7b19cc2eec6b27b47`). Only unchecked items show — self-clears as bought. Per-item quantity as trailing `×N` — tap to adjust. Swipe-left (mobile) or hover-X (desktop) to delete an item.

### 📅 The Week Ahead
Deputy roster for 7 days — shift times + area. Task count badge per day. Tap day = view/add tasks inline. Add panel supports recurring options (daily/weekly/fortnightly/monthly); recurring tasks deletable from here.

### 🎯 Projects (+ Brain Dump)
Brain Dump capture at top: free-text idea → `/api/braindump-analyze` (Opus) decides new project vs new action on existing → structured draft. Projects from Notion Projects DB. Status cycles In Progress → Blocked → On Hold → Done. Swipe-left archives (→ Notion trash, recoverable 30 days). Claude-logo button on an action = deep-link handoff to full Claude (Cowork on desktop; clipboard on mobile).

### ☕ Coffee Costings / 🥪 Food Costings
Live margin view from Notion Costings DB. Sorted worst→best margin. MarginBadge summary (avg %, red/amber/green counts). Add-product button → AddProductModal.

### 📦 Supplier Prices
Ingredient-level price tracking, grouped into collapsible supplier tiles with search. Cards show ingredient, supplier, price/unit, affected-product count. 7-day delta shown red/green. "Add ingredient from invoice" via `/api/find-ingredient-price`. Data from `SyncIngredientPrices` → Notion JSON block.

### 🐯 Tiger OS Updates
TIGER OS backlog tracker. Tasks + subtasks from Notion Backlog DB (`657d36eb15e84269b85765e20096c6be`). Reuses Projects UI patterns for subtask toggle/add. Badge shows open-task count.

---

## Notion Resources

| Resource | ID |
|---|---|
| Projects DB | `f7712afe4c7247d7b1690f2e1ecc1a0d` |
| Costings DB | `8f16358a47e54062b5fe1ce7a7480754` |
| Tiger OS Backlog DB (Updates widget) | `657d36eb15e84269b85765e20096c6be` |
| Main OS page (checked-state + ingredient_prices + recipe_map + price_drift_warnings JSON blocks) | `3403c99c0e858113a941c2118b3cdef9` |
| Shopping List page | `3683c99c0e8581c7b19cc2eec6b27b47` |
| Monday | `3403c99c0e858139bd34e9f3873dc7ef` |
| Tuesday | `3403c99c0e858133bb31f63559b18716` |
| Wednesday | `3403c99c0e85814fab17e09b32693999` |
| Thursday | `3403c99c0e8581a39fd1e3587887a1e0` |
| Friday | `3403c99c0e858192bfa7d94c8189fe3c` |
| Saturday | `3403c99c0e8581b3a01dc82031df8f09` |
| Sunday | `3403c99c0e8581fa80d7ef629e63aa9c` |

---

## API Routes

| Route | Method | Description |
|---|---|---|
| `/api/dashboard` | GET | All data: daily tasks (incl. Shopping List group), projects, weather. Edge-cached. |
| `/api/week-tasks` | GET | Tasks for next 7 days. Edge-cached. |
| `/api/roster` | GET | Deputy shifts for 7 days |
| `/api/costings` | GET | Product costings from Notion |
| `/api/todos` | PATCH | Toggle project/personal todo checked state |
| `/api/checked-state` | GET/POST | Read/write daily task checked state (Notion JSON block) |
| `/api/add-task` | POST | Add task to Notion day page; optional `context` field; Haiku category classify |
| `/api/task-context` | GET/POST | Read/write per-task context notes (keyed by block ID) |
| `/api/delete-task` | DELETE | Delete Notion block |
| `/api/add-shopping` | POST | Add item to Shopping List page (with `×N` qty) |
| `/api/update-shopping` | PATCH | Rewrite a shopping item's text (adjust qty) |
| `/api/add-project-action` | POST | Add to_do block to a project |
| `/api/project-status` | PATCH | Update project status |
| `/api/archive-project` | POST | Move project page to Notion trash (recoverable 30 days) |
| `/api/braindump` | POST | Create new project from brain dump |
| `/api/braindump-analyze` | POST | Opus: classify brain dump as new project vs action on existing |
| `/api/claude-assist` | POST | Opus chat for project actions |
| `/api/add-product` | POST | AddProduct Apps Script web app: writes costings sheet + Notion row |
| `/api/add-ingredient` | POST | Adds custom ingredient via AddProduct web app |
| `/api/find-ingredient-price` | POST | Proxies invoice-price keyword search to AddProduct web app |
| `/api/ingredient-prices` | GET | Reads chunked `ingredient_prices` JSON block from OS page |
| `/api/recipe-map` | GET | Reads `recipe_map` JSON block (ingredient→product attribution) |
| `/api/price-drift` | GET | Reads `price_drift_warnings` JSON block |
| `/api/tigeros-tasks` | GET | Fetch Tiger OS backlog tasks + subtasks (Updates widget) |
| `/api/login` | POST | Password auth → set `gdt_session` cookie |

---

## Environment Variables (Vercel)

| Variable | Used by |
|---|---|
| `NOTION_API_KEY` | All Notion API routes |
| `DEPUTY_ENDPOINT` | `/api/roster` |
| `DEPUTY_ACCESS_TOKEN` | `/api/roster` |
| `ANTHROPIC_API_KEY` | `/api/claude-assist`, `/api/braindump-analyze`, `/api/add-task` |
| `APP_PASSWORD` | Verified by `/api/login` |
| `SESSION_TOKEN` | Value of `gdt_session` cookie; `middleware.ts` gates the whole app |

---

## Auth

Password → `gdt_session` cookie (30 days, `sameSite: lax` for iOS PWA). `middleware.ts` gates the entire app.

---

## Costing Automation (Google Apps Script)

Scripts live in the Apps Script project linked to the Food Costings sheet. Local copies in `gdaytiger-app/apps-script/`.

```
Gmail → SaveInvoicesToDrive (hourly) → Drive folders
                                         ↓
                                  ScanSuppliers (hourly) → Food/Coffee Costings sheets
                                                                      ↓
                                         SyncCostingsToNotion (30 min) → Notion → TIGER OS
SyncSquarePrices (hourly) → live Square retail prices → Coffee Costings sheet
BuildRecipeMap (daily) → recipe_map JSON → Notion OS page
SyncIngredientPrices (30 min) → ingredient_prices JSON → Notion OS page
TakeawayCupCounter (daily) → Planetware cup reorder at 10,000 cups
```

| File | Purpose |
|---|---|
| `SaveInvoicesToDrive.js` | Gmail watcher — saves supplier PDF attachments to Drive, labels `invoice-saved` |
| `ScanSuppliers.js` | Reads Drive/Gmail PDFs → writes ingredient prices to Food + Coffee sheets |
| `SyncCostingsToNotion.js` | Pushes Sell Price + Profit % + Cost (Total+Wastage) to Notion Costings DB (30 min). Cost added Jun 2026 — food + coffee. |
| `SyncSquarePrices.js` | Pulls live Square retail prices → Coffee Costings sheet (hourly) |
| `SyncIngredientPrices.js` | Writes ingredient prices as chunked JSON to Notion OS page (30 min) |
| `BuildRecipeMap.js` | Parses FOOD sheet formulas → ingredient→product map → `recipe_map` Notion block (daily) |
| `TakeawayCupCounter.js` | Polls Square Orders daily, tallies Planetware cups. At 10,000, appends reorder to Shopping List. Counter start: 2026-06-01. |
| `AddProduct.js` / `AddIngredient.js` | Web-app endpoints backing in-app Add Product / Add Ingredient modals |
| `BackupCostings.js` | Costings sheet backup |

### Margin thresholds
- 🔴 Red: below 60%
- 🟡 Amber: 60–70%
- 🟢 Green: 70%+

---

## Git Branches

| Branch | Status |
|---|---|
| `main` | **Production** — all current code here |
| `feature/costings` | Stale — merged into main |
| `feature/personal-todo` | Stale — do not merge; rebuild fresh off `main` |

---

## Local Dev

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Requires `.env.local` with all env vars above.
