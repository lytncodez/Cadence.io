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
| POST | `/auth/forgot-password` `{ email }` | anyone · always 204, so it can't reveal who has an account; emails a one-time link |
| GET | `/auth/reset-password/{token}` | anyone · `{ valid, name, email }` |
| POST | `/auth/reset-password` `{ token, password }` | anyone with a valid link · signs the user out on every device |
| POST | `/users/{id}/send-reset` | `manage_users` · emails the link; returns it only if the email wasn't delivered |
| POST | `/demo-requests` | public website form · stored, emailed/texted to you; 5 per hour per address |
| GET | `/items` | `view_inventory` |
| GET | `/items/barcode/{code}` | signed in (batches FEFO-sorted) |
| POST | `/items` | `edit_inventory` |
| PATCH | `/items/{id}` | `edit_inventory` |
| DELETE | `/items/{id}` | `delete_inventory` |
| GET | `/users` · `/roles` · `/pharmacy` | signed in |
| PATCH | `/users/{id}` | yourself (name, phone, bio, photo, reg. no.) · admins (also position, department, role, status) |
| GET | `/analytics/monthly?months=6` | signed in |
| POST | `/items/import?dry_run=true\|false` | `import` · multipart `file` (.csv or .xlsx); dry run previews and lists bad rows |
| PATCH | `/pharmacy` | `company` · name, location, licence, `criticalDays`, `soonDays` |
| POST | `/ai/chat` `{ message, history?, datasetName?, rows? }` | `view_insights` → `{ kind, text, facts }`. With `rows`, the answer is about that uploaded data instead of the saved inventory |
| POST | `/items/parse` | `view_insights` + `import` · multipart `file`; validates a CSV/Excel file and returns its rows without saving (for “Analyse only”) |
| GET | `/ai/status` | signed in → `{ connected }` (true when an AI key is configured) |
| GET | `/alerts` · POST `/alerts/read` `[keys]` | signed in |
| GET/PUT | `/alerts/settings` | read: signed in · save: `manage_alerts` |
| POST | `/alerts/test-sms` · `/alerts/test-email` · `/alerts/send-digest` | `manage_alerts` |
| GET/DELETE | `/alerts/deliveries` | delivery log (last 20) |
| POST | `/alerts/cron` | external cron, header `X-Cron-Secret` |
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

## 6. Turning on real SMS, email and AI
Everything works in **mock** mode first: tests and digests are recorded in the delivery log (Alerts page) but nothing leaves the server. Switch each one on in Render → Environment, then redeploy.

**SMS (Ghana)**
- *Arkesel*: create an account at arkesel.com, request a sender ID (e.g. `Cadence`, max 11 characters) and copy your API key. Set `SMS_PROVIDER=arkesel`, `ARKESEL_API_KEY`, `SMS_SENDER_ID`.
- *Hubtel*: set `SMS_PROVIDER=hubtel`, `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `SMS_SENDER_ID`.
- Then Alerts → **Test SMS**. If it fails, the exact error from the provider shows in the delivery log.

**Email**
- Any SMTP account works. For Gmail: turn on 2-step verification, create an **App Password**, then set `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`, `SMTP_PASSWORD=<app password>`, `SMTP_FROM=you@gmail.com`.
- Then Alerts → **Test email**.

**AI wording**
- Set `AI_PROVIDER=anthropic` (or `openai`), the matching API key, and `AI_MODEL` to a model id from the provider's docs.
- Questions about your stock get only figures Cadence already calculated, and the model is told not to invent numbers.
- Any other question (medicines, storage, regulation, business, general knowledge) is answered from the model's own knowledge. Without a key, Cadence answers stock questions only and says general questions need the AI service.
- If the provider is down or the key is wrong, answers fall back to the built-in wording, so the page never breaks.

**Password reset and demo requests**
- Set `APP_URL` to your Vercel address (e.g. `https://cadence-io.vercel.app`). Reset emails link to `APP_URL/reset-password?token=…`.
- Set `DEMO_NOTIFY_EMAIL` to the inbox that should receive "Book a demo" requests (and optionally `DEMO_NOTIFY_SMS`).
- Every request is also stored. List them with `python -m app.leads`, or `python -m app.leads --csv > leads.csv`.
- Until email is switched on, "Forgot password" can't deliver anything. Admins can still open a person's profile → **Reset password**, and Cadence shows the link to pass on in person.

**Daily digest**
Render's free plan sleeps, so a timer inside the app isn't reliable. Use a free scheduler instead:
1. cron-job.org → new job → URL `https://<your-service>.onrender.com/api/v1/alerts/cron`, method **POST**, every 15 minutes.
2. Add header `X-Cron-Secret` with the value of `CRON_SECRET` from Render.
Each pharmacy gets one digest per day, after its "Send at" time (Ghana time).

## Database migrations
`alembic upgrade head` runs on every deploy (see the Dockerfile). Version `0002` adds `notification_settings`, `alert_reads` and `notification_log`. Version `0003` adds `password_resets`, `demo_requests` and `users.password_changed_at`.

## Next
Staff invites by email, purchase orders, multi-branch stock transfers.
