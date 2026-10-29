# Cadence.io API

FastAPI + SQLAlchemy 2 (async) + PostgreSQL on Neon, deployed to Render. Serves the `cadence-web` frontend.

## Data model
```
pharmacies ─┬─ roles            (permissions per role, per pharmacy)
            ├─ users            (role, position, staff ID, PSGH reg. no., photo…)
            └─ products ── batches ── sales
```
A **product** is identified by its barcode. Every delivery is a **batch** with its own batch number, expiry date and quantity.
**Sales** point at the batch they came from, so revenue, cost and "sold this month" are always calculated, never stored twice.
Expiry status (expired / critical / soon / safe) is computed from the expiry date, never stored.

## Endpoints (`/api/v1`)
| Method | Path | Who |
|---|---|---|
| POST | `/auth/login` | anyone → `{ access_token, user }` |
| GET | `/auth/me` | signed in |
| POST | `/auth/change-password` | signed in |
| GET | `/items` | `view_inventory` |
| GET | `/items/barcode/{code}` | signed in (batches FEFO-sorted) |
| POST | `/items` | `edit_inventory` |
| PATCH | `/items/{id}` | `edit_inventory` |
| DELETE | `/items/{id}` | `delete_inventory` |
| GET | `/users` · `/roles` · `/pharmacy` | signed in |
| PATCH | `/users/{id}` | yourself (name, phone, bio, photo, reg. no.) · admins (also position, department, role, status) |
| GET | `/analytics/monthly?months=6` | signed in |
| GET | `/health` | Render health check |

Interactive docs at `/docs`.

---

## 1. Run it on your computer (Windows PowerShell)
```powershell
cd cadence-api
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # then edit .env (step 2 gives you DATABASE_URL)
alembic upgrade head        # creates the tables
python -m app.seed          # demo pharmacy, 4 staff, 36 batches, 6 months of sales
uvicorn app.main:app --reload
```
Open http://localhost:8000/docs. Run the tests with `pytest -q` (they use a throwaway SQLite file, not Neon).

## 2. Database on Neon
1. Sign in at neon.tech → **New project** → name it `cadence`, Postgres 16, region **AWS Europe Central (Frankfurt)**.
2. **Connection Details** → choose **Pooled connection** → copy the string.
3. Paste it into `.env` as `DATABASE_URL`. Keep the `?sslmode=require` on the end; the app handles it.
4. Run `alembic upgrade head` and `python -m app.seed` from your computer. That creates and fills the Neon database.

## 3. API on Render
1. Push `cadence-api` to its own GitHub repo.
2. Render → **New → Blueprint** → pick the repo. Render reads `render.yaml`.
3. When asked, fill in:
   - `DATABASE_URL`: the Neon pooled string
   - `ALLOWED_ORIGINS`: `http://localhost:5173` for now (you add the Vercel URL in step 4)
   - `SEED_PASSWORD`: any password (only used if you seed from Render)
   - `JWT_SECRET` is generated for you.
4. Deploy. Migrations run on every start. Check `https://<your-service>.onrender.com/health` returns `{"status":"ok"}`.

The free plan sleeps after 15 minutes without traffic; the first request after that takes about 50 seconds.

## 4. Frontend on Vercel
1. Push `cadence-web` to its own GitHub repo.
2. Vercel → **Add New → Project** → import it. Framework: Vite (detected).
3. Environment variables:
   - `VITE_USE_MOCK` = `false`
   - `VITE_API_URL` = `https://<your-service>.onrender.com/api/v1`
4. Deploy, copy the Vercel URL, then go back to Render → `cadence-api` → Environment → add it to `ALLOWED_ORIGINS` (comma-separated). Preview deployments on `*.vercel.app` are already allowed.

## 5. First sign-in
Log in as `abena@harbourview.example` with your `SEED_PASSWORD`, then change the password from **Profile → Password**.
Before real use, remove the demo data with `python -m app.seed --wipe` (it asks you to type RESET), then create your real pharmacy and first admin with `python -m app.create_admin`.

## Next (Phase 3)
Alerts + SMS, AI insights (explaining the numbers from `/analytics`, never inventing them), pharmacy settings and invites.
