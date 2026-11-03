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
| POST | `/auth/signup` | anyone · creates a pharmacy, its roles and its first admin; returns `{ access_token, user }` |
| POST | `/auth/login` | anyone → `{ access_token, user }` · 10 wrong passwords → 15-minute wait |
| GET | `/auth/me` | signed in |
| POST | `/auth/change-password` | signed in |
| POST | `/auth/forgot-password` `{ email }` | anyone · always 204, so it can't reveal who has an account; emails a one-time link |
| GET | `/auth/reset-password/{token}` | anyone · `{ valid, name, email }` |
| POST | `/auth/reset-password` `{ token, password }` | anyone with a valid link · signs the user out on every device |
| POST | `/users` | `manage_users` · invite: creates the person (Invited) and emails a 3-day link to set their password |
| GET | `/integrations` · POST `/integrations/test-ai` | `manage_alerts` or `company` · Live / Demo / Needs setup for SMS, email, AI, digest, encryption |
| POST | `/users/{id}/send-reset` | `manage_users` · emails the link; returns it only if the email wasn't delivered |
| POST | `/demo-requests` | public website form · stored, emailed/texted to you; 5 per hour per address |
| GET | `/items` | `view_inventory` · `unitCost` is null without `view_finance` |
| GET | `/items/barcode/{code}` | signed in (batches FEFO-sorted) |
| POST | `/items` | `edit_inventory` |
| PATCH | `/items/{id}` | `edit_inventory` |
| DELETE | `/items/{id}` | `delete_inventory` |
| GET | `/users` · `/roles` · `/pharmacy` | signed in |
| PATCH | `/users/{id}` | yourself (name, phone, bio, photo, reg. no.) · admins (also position, department, role, status) |
| GET | `/analytics/monthly?months=6` | `view_finance` |
| POST | `/items/import?dry_run=true\|false` | `import` · multipart `file` (.csv or .xlsx); dry run previews and lists bad rows |
| PATCH | `/pharmacy` | `company` · name, location, licence, `criticalDays`, `soonDays` |
| POST | `/ai/chat` `{ message, history?, datasetName?, rows? }` | `view_insights` → `{ kind, text, facts }`. With `rows`, the answer is about that uploaded data instead of the saved inventory |
| POST | `/items/parse` | `view_insights` + `import` · multipart `file`; validates a CSV/Excel file and returns its rows without saving (for “Analyse only”) |
| GET | `/ai/status` | signed in → `{ connected }` (true when an AI key is configured) |
| GET | `/alerts` · POST `/alerts/read` `[keys]` | signed in |
| GET/PUT | `/alerts/settings` | read: signed in · save: `manage_alerts` |
| POST | `/alerts/test-sms` · `/alerts/test-email` · `/alerts/send-digest` · `/alerts/send-weekly` | `manage_alerts` · tests and digests go to the typed numbers/address plus chosen team members |
| GET | `/announcements` | signed in · in-app messages from Cadence HQ for this pharmacy (last 30 days) |
| GET/DELETE | `/alerts/deliveries` | `manage_alerts` · delivery log (last 20) |
| POST | `/alerts/cron` | external cron, header `X-Cron-Secret` · daily digests, weekly AI reports and the HQ email |
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
1. neon.tech → **New project** → name `cadence`, region **AWS Europe Central (Frankfurt)** (same region as the Render service).
2. **Connection Details** → **Pooled connection** → copy the string (keep `?sslmode=require`).
3. Keep it for step 3. You don't need to run anything against Neon yourself: Render runs the migrations on every deploy.

## 3. API on Render (free plan)
The repo is a monorepo (`cadence-api/`, `cadence-web/`). `render.yaml` sits at the **repo root** and points Render at `cadence-api/`.
1. Render → **New → Blueprint** → connect GitHub → pick `lytncodez/Cadence.io` → Render reads `render.yaml`.
2. Fill in the values it asks for:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon pooled string |
   | `ALLOWED_ORIGINS` | your Vercel address (step 4), plus `http://localhost:5173` while testing; comma-separated |
   | `APP_URL` | your Vercel address, no trailing `/` (used in reset and invite links) |
   | `DATA_ENCRYPTION_KEY` | the key from your `.env` (the **same** value) |
   | `DEMO_NOTIFY_EMAIL` | your own inbox (demo requests and new sign-ups) |
   | `SEED_PASSWORD` | anything (only used if you load demo data) |
   `JWT_SECRET` and `CRON_SECRET` are generated for you. Leave the provider keys empty for now (section 6).
3. **Apply**. The first build takes a few minutes. Open `https://<service>.onrender.com/health` → `{"status":"ok"}`.

The free plan sleeps after 15 minutes without traffic; the first request after that takes about 50 seconds. It also **blocks SMTP email**, which is why section 6 uses Brevo.

## 4. Frontend on Vercel
1. Vercel → **Add New → Project** → import `lytncodez/Cadence.io`.
2. **Root Directory** → **Edit** → choose `cadence-web`. Framework: Vite (detected). `cadence-web/vercel.json` handles routing and security headers.
3. Environment variables: `VITE_USE_MOCK` = `false`, `VITE_API_URL` = `https://<service>.onrender.com/api/v1`.
4. **Deploy**, copy the address (e.g. `https://cadence-io.vercel.app`), and make sure it's in `ALLOWED_ORIGINS` and `APP_URL` on Render (Render redeploys when you save).

## 5. First pharmacy
Open the Vercel address → **Create account** → fill in your pharmacy and yourself. You're its admin. Every other pharmacy does the same and gets its own, completely separate account. Invite staff from **Settings → Team → Invite**.
Prefer to add pharmacies yourself? Set `SIGNUP_ENABLED=false` and use `python -m app.create_admin` (run locally with `DATABASE_URL` pointing at Neon).
Check everything from your computer: `python -m app.smoke https://<service>.onrender.com https://<your-site>.vercel.app you@yourpharmacy.com`

## 6. Turning on SMS, email and AI
Everything works in **mock** mode first: messages appear in the delivery logs but nothing leaves the server. Turn each on in Render → `cadence-api` → **Environment**, save (Render redeploys), then check **HQ → System** (or **Settings → Integrations** in a pharmacy): it shows Live / Demo / Needs setup for each one and has test buttons.

**Go-live checklist** (Render → Environment)
| Variable | Value |
|---|---|
| `SMS_PROVIDER` · `ARKESEL_API_KEY` · `SMS_SENDER_ID` | `arkesel` · your key · the approved sender ID |
| `EMAIL_PROVIDER` · `BREVO_API_KEY` · `EMAIL_FROM` | `brevo` · your key · the verified sender address |
| `AI_PROVIDER` · `ANTHROPIC_API_KEY` · `AI_MODEL` | `anthropic` · your key · `claude-haiku-5-5` |
| `HQ_NOTIFY_EMAIL` · `HQ_NOTIFY_SMS` | your inbox · your phone |
| `CRON_SECRET` | already generated by Render; copy it into cron-job.org (below) |
| `APP_URL` | your Vercel address, so links in emails work |

Then: HQ → System → send yourself a test email, a test SMS and **Test AI**. In a pharmacy: Alerts → **Test SMS** / **Test email** / **Send this week's report now**.

**What gets sent, to whom**
| Message | Goes to | Channel |
|---|---|---|
| Daily digest (+ AI "today's priorities" when AI is on) | the pharmacy's alert numbers/email + chosen team members | SMS + email |
| Weekly AI report (sales, losses, 3 priorities) | alert email + chosen team members who can see finance | email |
| Welcome email | a new pharmacy's admin, on sign-up | email |
| Invites, password resets | the person | email |
| Help request received | the person who asked (confirmation); you (`HQ_NOTIFY_EMAIL`, and `HQ_NOTIFY_SMS` if urgent) | email / SMS |
| HQ reply to a help request | the person who asked; optionally their callback number | email / SMS |
| Announcements from HQ | chosen pharmacies: in-app banner, and/or their admins | app / email / SMS |
| HQ daily email (AI briefing, sign-ups, at-risk, open help) | `HQ_NOTIFY_EMAIL` | email |

Team members who can't see finance (dispensers by default) get the same alerts with every money figure left out.

**SMS: Arkesel (Ghana)**
1. Sign up at arkesel.com, top up a little credit, and request a **sender ID** (e.g. `Cadence` or your pharmacy's short name, up to 11 characters). Approval can take a day or two.
2. Dashboard → **SMS API** → copy your API key.
3. Render: `SMS_PROVIDER=arkesel`, `ARKESEL_API_KEY=…`, `SMS_SENDER_ID=<the approved ID>`.
4. In the app: Alerts → add your number → **Save** → **Test SMS**. Errors from Arkesel show in the delivery log.
(Hubtel also works: `SMS_PROVIDER=hubtel`, `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `SMS_SENDER_ID`.)

**Email: Brevo (works on Render's free plan)**
1. Sign up at brevo.com (free: 300 emails a day).
2. **Senders, domains & IPs** → add and verify the sender address you'll send from. A domain you own (e.g. `alerts@yourpharmacy.com`) is best: add the DNS records Brevo shows. A Gmail address can work for testing but is more likely to land in spam.
3. **SMTP & API → API keys** → create a key.
4. Render: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY=…`, `EMAIL_FROM=<the verified address>`, `EMAIL_FROM_NAME=Cadence`.
5. In the app: Alerts → add an email → **Save** → **Test email**. Then try "Forgot password" and an invite.
(Resend also works if you own a domain: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`. Gmail SMTP only works locally or on a paid Render plan.)

**AI: Anthropic (or OpenAI)**
1. console.anthropic.com → add a little credit → **API keys** → create a key.
2. Render: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…`, `AI_MODEL=claude-haiku-5-5` (fast and low cost; `claude-sonnet-5-5` for richer answers). Check docs.claude.com for current model names.
3. In the app: Settings → Integrations → **Test AI**, then ask AI Insights a general question.
Questions about the pharmacy's own figures only ever get numbers Cadence calculated; the model explains them. If the provider is down, answers fall back to built-in wording.
(OpenAI: `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `AI_MODEL` from platform.openai.com.)

**Daily digest, weekly report and HQ email**
Render's free plan sleeps, so use a free scheduler:
1. cron-job.org → new job → URL `https://<service>.onrender.com/api/v1/alerts/cron`, method **POST**, every 15 minutes.
2. Advanced → header `X-Cron-Secret` = the `CRON_SECRET` value from Render.
Each pharmacy gets one digest a day after its "Send at" time (Ghana time), and the weekly AI report on its chosen day. You get the HQ email once a day after `HQ_DIGEST_TIME`.

**Costs to expect:** Brevo free covers 300 emails a day. Arkesel charges per SMS segment (160 characters). AI uses a few cents a day per pharmacy with `claude-haiku-5-5`: one short call for the digest note, one a week for the report, plus questions people ask.

## Cadence HQ (for you, not for pharmacies)
`<your site>/hq` is a separate console with its own logins (table `platform_admins`, tokens scoped to HQ). Pharmacy logins can't open it, and HQ logins can't open any pharmacy's stock.
- **What HQ sees:** each pharmacy's name, town, join date and admin contact; how many people use it and on how many days; last activity; counts of logins, AI questions, batches added, rows imported and invites; whether SMS/email alerts are on; and its help requests. Health labels: Active (used in the last 3 days), Quiet (3-14 days), At risk (14+ days), New, Never used.
- **What HQ never sees:** stock, batches, prices, costs, sales, margins, the text of AI questions, alert phone numbers or emails, or patients. Usage is stored as `usage_events` rows holding only kind, count and time.
- **Get help (distress button):** every pharmacy user has a **Get help** button. Requests appear in HQ > Help requests, are emailed to `HQ_NOTIFY_EMAIL`, and urgent ones are also texted to `HQ_NOTIFY_SMS`. Your reply shows in the pharmacy's app and is emailed to the person who asked. HQ also lists website demo requests.
- **Today's briefing (Overview) and Ask AI:** Cadence AI tells you who to call and why, who needs onboarding help, which features are under-used and who has alerts off. It's given **only** the usage counts above (no admin names or emails either) and told never to invent figures; with AI off you get a built-in summary.
- **Messages:** send an announcement to all pharmacies, a status group (Active, Quiet, At risk, New, Never used) or chosen ones, as an in-app banner, an email and/or an SMS to their admins. "Write it for me" turns rough notes into a title, message and SMS. You see the reach before sending; history shows how many went out or failed.
- **System:** which providers are live, test email/SMS/AI to yourself, preview or send the HQ daily email, and a log of everything HQ sent.
- **Create your HQ login** (once, from your computer with `.env` pointing at Neon): `python -m app.create_hq_admin`. Run it again with the same email to change the password.

| Method | Path | Who |
|---|---|---|
| POST | `/support/tickets` · GET `/support/tickets` | any pharmacy user · raise / see your pharmacy's requests |
| POST | `/hq/auth/login` · GET `/hq/me` | HQ |
| GET | `/hq/overview` · `/hq/pharmacies` · `/hq/pharmacies/{id}` | HQ · usage only |
| GET/PATCH | `/hq/tickets` · `/hq/tickets/{id}` | HQ · help requests, reply and status |
| GET/PATCH | `/hq/leads` · `/hq/leads/{id}` | HQ · website demo requests |
| GET | `/hq/system` · POST `/hq/test` `{ channel, to? }` · GET `/hq/deliveries` | HQ · provider status, tests, message log |
| GET | `/hq/digest/preview` · POST `/hq/digest/send` | HQ · the daily HQ email |
| POST | `/hq/ai/briefing` · `/hq/ai/chat` `{ message, history }` · `/hq/ai/draft` `{ notes }` | HQ · AI on usage counts only |
| POST/GET | `/hq/broadcasts` (`dryRun` to count reach) | HQ · announcements to pharmacies |

## Several pharmacies
Every table row belongs to one pharmacy, and every query filters by the signed-in user's `pharmacy_id`. Asking for another pharmacy's batch, user or settings returns 404, as if it didn't exist; the tests check this for every endpoint. Each pharmacy has its own roles, alert settings, team and AI context. Emails are unique across Cadence: one login per person.

## Security
- **Passwords** are hashed with Argon2. Reset links are stored only as SHA-256 hashes and work once.
- **In transit:** Render and Vercel serve HTTPS only; the API sends HSTS, `nosniff`, `X-Frame-Options: DENY`, `no-store`. The connection to Neon uses TLS with certificate checks.
- **At rest:** Neon encrypts its disks (AES-256). On top of that, Cadence encrypts personal data field by field with `DATA_ENCRYPTION_KEY` (Fernet: AES + HMAC): staff phone numbers and PSGH registration numbers, alert phone numbers and email, the delivery log's recipients, and demo-request contact details. Sign-in emails stay readable because login looks them up.
  1. Generate a key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
  2. Put it in `.env` **and** in Render → Environment as `DATA_ENCRYPTION_KEY`. Same value in both. Keep a copy in a password manager: without it, that data can't be read.
  3. Deploy (runs migration `0004`), then once: `python -m app.encrypt_existing` to encrypt rows saved before.
  4. To rotate: put a new key first, comma, old key (`NEW,OLD`), redeploy, run `python -m app.encrypt_existing`, then remove the old key.
- **Role-based data:** people without `view_finance` (dispensers by default) never receive cost prices, margins, revenue or stock values from the API; they still see selling prices, which they need at the counter.

## Database migrations
`alembic upgrade head` runs on every deploy (see the Dockerfile). Version `0002` adds `notification_settings`, `alert_reads` and `notification_log`. Version `0003` adds `password_resets`, `demo_requests` and `users.password_changed_at`. Version `0004` widens personal-data columns for encryption. Version `0005` adds `platform_admins`, `usage_events`, `support_tickets` and `users.last_seen_at` for Cadence HQ. Version `0006` adds alert recipients from the team and the weekly report settings (`notification_settings`), `announcements` and `hq_deliveries`.

## Next
Staff invites by email, purchase orders, multi-branch stock transfers.
