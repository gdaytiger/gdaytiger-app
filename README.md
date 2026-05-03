# TIGER OS

G'Day Tiger internal operations dashboard. Built on Next.js, deployed on Vercel, data from Notion.

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js (App Router) |
| Styling | Tailwind CSS + inline styles |
| Hosting | Vercel |
| Database | Notion (via REST API) |
| Automation | Google Apps Script |
| Fonts | Stolzl (labels), Bodoni PT (headings) |

---

## Deploying

Always deploy via the included script — it merges the current branch into `main` and pushes, which triggers Vercel automatically.

```bash
bash deploy.sh
```

Live in ~30 seconds after push. To roll back, go to **vercel.com → your project → Deployments → Promote** any previous deployment.

---

## Dashboard Cards

### ⚡ Daily To Do
Pulls today's tasks from Notion. Swipe right to defer to tomorrow, swipe left to delete. Recurring tasks (no date prefix) stay in Notion and reappear each cycle.

### 📅 The Week Ahead
Roster pulled from Notion. Tap any day to view/add tasks for that date. Task count badge shows items per shift.

### 🎯 Ongoing Projects
Projects from Notion with next-action checklists. Click status badge to cycle (In Progress → Blocked → On Hold → Done). 🤖 button opens Claude assistant for any action item.

### 🧠 Brain Dump
Free-text idea capture. "Move to Projects" promotes it to Notion with a project name and up to 3 next actions.

### 💰 Product Costings
Live margin view pulled from the Notion Product Costings database.
- Two columns: **Coffee** (left) and **Food** (right), sorted worst → best margin
- Thumb-scrollable, no scrollbar, fade mask at edges
- Liquid glass card style matching the rest of the UI
- Highlight banners: red (<60%), amber (60–70%), green (70%+)
- **Ingredient price change panel**: saves a localStorage snapshot on each load, shows any margin shifts with pp change and implied cost impact on subsequent loads

---

## Notion Databases

| Database | ID |
|---|---|
| Product Costings | `8f16358a47e54062b5fe1ce7a7480754` |

### Costings DB schema

| Field | Type | Notes |
|---|---|---|
| Name | Title | Product name |
| Category | Select | Coffee / Food / Retail / Vending |
| Sell Price | Number | Retail price |
| Profit % | Number | Synced by Apps Script every 30 min |
| Cost | Number | Legacy calculated cost (may be null — Profit % is primary) |
| Last Reviewed | Date | Triggers ⚠️ if >60 days ago |
| Notes | Text | Free notes |

---

## API Routes

| Route | Method | Description |
|---|---|---|
| `/api/dashboard` | GET | Daily tasks, projects, personal todos, weather |
| `/api/costings` | GET | All products from Notion with margin calculated |
| `/api/roster` | GET | Week's shifts |
| `/api/week-tasks` | GET | Tasks per day this week |
| `/api/checked-state` | GET / POST | Persist checkbox state server-side |
| `/api/add-task` | POST | Add a task to a specific date |
| `/api/delete-task` | DELETE | Remove a Notion block |
| `/api/add-project-action` | POST | Add next action to a project |
| `/api/project-status` | PATCH | Cycle project status |
| `/api/braindump` | POST | Promote brain dump to project |
| `/api/todos` | PATCH | Toggle project/personal todo |
| `/api/claude-assist` | POST | Proxy to Claude API for in-app assistant |
| `/api/login` | POST | Password auth |

---

## Costing Automation (Google Apps Script)

All scripts live in the standalone Apps Script project linked to the Food Costings spreadsheet.  
Access: [script.google.com/home](https://script.google.com/home) → open the project linked to the Food Costings sheet.

Local copies saved to: `/Users/gdaytiger/Documents/Claude/Projects/TIGER OS/`

### Scripts

| File | Purpose | Trigger |
|---|---|---|
| `ScanSuppliers.gs` | Invoice scanner — reads Drive/Gmail for new invoices and writes updated ingredient prices to Food + Coffee Costings sheets | Hourly via `createScanTrigger()` |
| `SyncCostingsToNotion.gs` | Reads Sell Price + Profit % from both sheets, pushes to Notion Product Costings DB | Every 30 min via `updateSyncTrigger()` |
| `CoffeeCostingsSetup.gs` | One-time setup — archives old Coffee Notion items, recreates 52 fresh ones from COFFEE COSTINGS sheet | Run manually after major Coffee sheet changes |

### Invoice scanner supplier coverage

**Food sheet (FOOD tab):**
- 5Ways — Drive TAX INVOICEs
- Sciclunas — Drive FreshoInvoice PDFs
- Uncle's — Drive Order Confirmation PDFs
- Woolworths — Drive eReceipt PDFs
- PFD Foods — Gmail (PFDPortal@pfdfoods.com.au)
- Abicor/Trio — Gmail (abicorsouthern.com.au) — built, verify on next invoice
- Dench Bakers — Drive Invoice PDFs (Xero format)
- Noisette, Product Distribution, Candied Bakery — Drive

**Coffee sheet (COFFEE tab):**
- Seven Seeds, Mörk, Matsu Tea, Redi Milk, 5Ways (Bundaberg Sugar)

### Margin thresholds
- 🔴 Red: below 60%
- 🟡 Amber: 60–70%
- 🟢 Green: 70%+

---

## Environment Variables (Vercel)

| Variable | Used by |
|---|---|
| `NOTION_API_KEY` | All `/api/` routes that talk to Notion |
| `ANTHROPIC_API_KEY` | `/api/claude-assist` |
| `DASHBOARD_PASSWORD` | `/api/login` |

---

## Local Dev

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Requires environment variables set in `.env.local`.

---

## Git Branches

| Branch | Purpose |
|---|---|
| `main` | Production — auto-deploys to Vercel on push |
| `feature/costings` | Active development branch |

`deploy.sh` merges current branch → main and pushes both.
