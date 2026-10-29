# Cadence.io — web app

React + TypeScript + Tailwind CSS v4, built with Vite. Runs on sample data until the FastAPI backend is connected.

## Run locally
```bash
npm install
cp .env.example .env.local   # optional; mock mode is the default
npm run dev                  # http://localhost:5173
```
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
  components/charts.tsx    Sparkline, RevenueChart, StatusDonut, ExpiryHeatmap
  pages/                   Login, Overview, Inventory, Profile, Team, coming-soon pages
```

## Keyboard
`⌘K` / `Ctrl K` or `/` opens the command bar · `N` adds stock · `Esc` closes dialogs.

## Deploy to Vercel
1. Push this folder to GitHub.
2. Vercel → New Project → import the repo. Framework is detected as Vite.
3. Add the environment variables from `.env.example`. Keep `VITE_USE_MOCK=true` until the API is live on Render.
4. Deploy. `vercel.json` rewrites every route to `index.html` so deep links like `/inventory` work.

## Connecting the backend
Set `VITE_USE_MOCK=false` and `VITE_API_URL`. The app expects:

| Call | Route |
|---|---|
| Sign in | `POST /auth/login` `{ email, password }` → `{ access_token, user }` |
| Change password | `POST /auth/change-password` `{ current, next }` |
| Batches | `GET/POST /items`, `PATCH/DELETE /items/{id}` |
| Team | `GET /users`, `PATCH /users/{id}`, `GET /roles` |
| Sales history | `GET /analytics/monthly` → `[{ label, year, revenue, cost }]` |

Field names follow `src/lib/types.ts`.

## Roadmap
- **Phase 1 (this)**: design system, shell, login, overview, inventory, profile, team.
- **Phase 2**: database on Neon + FastAPI on Render, real auth.
- **Phase 3**: AI Insights, Alerts, full Settings.
- **Phase 4**: marketing website on Next.js.
