# Cadence.io — web app

React + TypeScript + Tailwind CSS v4, built with Vite. Runs on sample data until the FastAPI backend is connected.

## Run locally
```bash
npm install
cp .env.example .env.local   # optional; mock mode is the default
npm run dev                  # http://localhost:5173
```
Routes: `/` website · `/login` sign in · `/app` dashboard.
Demo accounts (mock mode, password `cadence2026`): Abena Mensah (Admin), Kojo Asante (Pharmacist), Efua Owusu (Dispenser).

## Stack
| Layer | Choice | Why |
|---|---|---|
| UI | React 19 + TypeScript | Typed components that mirror the FastAPI/Pydantic models |
| Styling | Tailwind CSS v4 + design tokens in `src/styles/index.css` | One source of truth for light and dark themes |
| Components | Headless UI (dialogs, menus, combobox, switches) + `cva` variants | Accessible by default, fully restyled |
| Icons | Lucide (via `react-icons/lu`) | |
| Charts | d3-shape + d3-scale, hand-drawn SVG | Exact control over the look; small bundle |
| Validation | Zod | Same rules as the Pydantic schemas |

## Structure
```
src/
  styles/index.css         design tokens, dark mode, grain/hex/mesh surfaces, animations
  lib/                     api (mock + live), analytics, router, theme, hooks, types, seed data
  components/ui/           Button, Input, Field, Card, StatusPill, Avatar (hexagon), Modal, Drawer, Toasts
  components/layout/       AppShell (sidebar, top bar, mobile tab bar), CommandPalette (⌘K)
  components/site/         website product tour and motion helpers (Reveal, CountUp, Marquee)
  components/charts.tsx    Sparkline, RevenueChart, StatusDonut, ExpiryHeatmap
  lib/features.ts          alerts, SMS/email delivery, AI insights, CSV/Excel import, pharmacy settings
  pages/                   Website, Login, Overview, Inventory, Insights, Alerts, Settings, Profile
```

## Roles
Everyone signs in at `/login` and lands on the home built for their job:
- **Admin**: Overview (sales, margins, expiry) plus *Your team* and a setup checklist.
- **Pharmacist**: Overview plus *Reorder soon*.
- **Dispenser** (no `view_finance`): **Counter**: scan or type a medicine, see which batch to hand over, what to pull from the shelf and what's running low. No cost prices, margins, revenue or stock values: the API doesn't send them, and the app hides those columns.

## Security
`vercel.json` sets HSTS, a Content-Security-Policy (no inline scripts: the pre-paint theme code lives in `public/theme-init.js`), `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy.

## Keyboard
`⌘K` / `Ctrl K` or `/` opens the command bar · `N` adds stock · `Esc` closes dialogs.

## Deploy to Vercel
1. Vercel → **Add New → Project** → import the GitHub repo.
2. **Root Directory** → `cadence-web` (the repo also holds `cadence-api`).
3. Environment variables: `VITE_USE_MOCK=false`, `VITE_API_URL=https://<your-api>.onrender.com/api/v1`.
4. Deploy. `vercel.json` rewrites every route to `index.html` (so `/app/inventory?status=critical` works) and sets security headers.

Routes: `/` website · `/signup` create a pharmacy account · `/login` · `/reset-password?token=…` (reset and invite links) · `/app/...`.

## Connecting the backend
Set `VITE_USE_MOCK=false` and `VITE_API_URL`. The app expects:

| Call | Route |
|---|---|
| Sign in | `POST /auth/login` `{ email, password }` → `{ access_token, user }` |
| Change password | `POST /auth/change-password` `{ current, next }` |
| Batches | `GET/POST /items`, `PATCH/DELETE /items/{id}` |
| Team | `GET /users`, `PATCH /users/{id}`, `GET /roles` |
| Sales history | `GET /analytics/monthly` → `[{ label, year, revenue, cost }]` |
| AI insights | `POST /ai/chat` `{ message, history, datasetName?, rows? }` → `{ kind, text }` · `GET /ai/status` |
| Analyse a file | `POST /items/parse` (multipart `file`) → `{ total, rows, errors }`, nothing saved |
| Alerts | `GET /alerts`, `POST /alerts/read`, `GET/PUT /alerts/settings`, `POST /alerts/test-sms`, `/alerts/test-email`, `/alerts/send-digest`, `GET /alerts/deliveries` |
| Import | `POST /items/import?dry_run=true\|false` (multipart `file`) |
| Pharmacy | `GET/PATCH /pharmacy` |

Field names follow `src/lib/types.ts`.

## Roadmap
- **Phase 1 (this)**: design system, shell, login, overview, inventory, profile, team.
- **Phase 2**: database on Neon + FastAPI on Render, real auth.
- **Phase 3**: AI Insights, Alerts with SMS/email, CSV/Excel import, pharmacy settings. ✓
- **Phase 4**: website polish (pricing, blog, SEO). The website itself is already at `/`.
