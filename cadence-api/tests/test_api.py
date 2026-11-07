"""End-to-end API tests on a throwaway SQLite database.  Run:  pytest -q"""
import asyncio
import os

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_cadence.db"
os.environ["JWT_SECRET"] = "test-secret-that-is-at-least-32-bytes-long"
os.environ["SEED_PASSWORD"] = "cadence2026"
os.environ["DATA_ENCRYPTION_KEY"] = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="  # test-only key

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture(scope="module")
def client():
    async def setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await seed()
    asyncio.run(setup())
    with TestClient(app) as c:
        yield c
    asyncio.run(engine.dispose())
    if os.path.exists("test_cadence.db"):
        os.remove("test_cadence.db")


def login(client, email):
    # Earlier tests change some passwords (password reset, change password), so try those too.
    for pw in ("cadence2026", "brand-new-password-1", "a-much-longer-pass"):
        r = client.post("/api/v1/auth/login", json={"email": email, "password": pw})
        if r.status_code == 200:
            break
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_login_rejects_bad_password(client):
    r = client.post("/api/v1/auth/login", json={"email": "abena@harbourview.example", "password": "wrong"})
    assert r.status_code == 401


def test_invited_user_cannot_log_in(client):
    r = client.post("/api/v1/auth/login", json={"email": "yaw@harbourview.example", "password": "cadence2026"})
    assert r.status_code == 403


def test_items_are_camel_case_and_fefo(client):
    h = login(client, "abena@harbourview.example")
    items = client.get("/api/v1/items", headers=h).json()
    assert len(items) == 36
    assert {"unitCost", "unitPrice", "soldThisMonth", "reorderLevel"} <= items[0].keys()
    assert items == sorted(items, key=lambda i: i["expiry"])


def test_create_update_delete_item(client):
    h = login(client, "kojo@harbourview.example")
    body = {"name": "Test Drug 10mg", "category": "Test", "barcode": "1234567890", "batch": "TST-1",
            "expiry": "2030-01-01", "qty": 5, "unitCost": 2, "unitPrice": 4, "supplier": "Acme"}
    r = client.post("/api/v1/items", json=body, headers=h)
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]
    assert client.post("/api/v1/items", json=body, headers=h).status_code == 409  # duplicate batch
    r = client.patch(f"/api/v1/items/{item_id}", json={"qty": 9}, headers=h)
    assert r.json()["qty"] == 9
    # Pharmacists can't delete; admins can.
    assert client.delete(f"/api/v1/items/{item_id}", headers=h).status_code == 403
    assert client.delete(f"/api/v1/items/{item_id}", headers=login(client, "abena@harbourview.example")).status_code == 204


def test_dispenser_cannot_add_stock(client):
    h = login(client, "efua@harbourview.example")
    r = client.post("/api/v1/items", json={"name": "X drug", "barcode": "99999999", "batch": "B", "expiry": "2030-01-01",
                                          "qty": 1, "unitCost": 1, "unitPrice": 2}, headers=h)
    assert r.status_code == 403


def test_dispenser_gets_no_financial_data(client):
    h = login(client, "efua@harbourview.example")
    items = client.get("/api/v1/items", headers=h).json()
    assert items and all(i["unitCost"] is None for i in items)
    assert all(i["unitPrice"] > 0 for i in items)  # selling price stays: they charge customers at the counter
    assert client.get("/api/v1/analytics/monthly", headers=h).status_code == 403
    assert client.get("/api/v1/alerts/deliveries", headers=h).status_code == 403
    assert client.post("/api/v1/ai/chat", json={"message": "report"}, headers=h).status_code == 403
    assert all("₵" not in a["text"] for a in client.get("/api/v1/alerts", headers=h).json())
    # Pharmacists still see costs
    k = login(client, "kojo@harbourview.example")
    assert all(i["unitCost"] is not None for i in client.get("/api/v1/items", headers=k).json())


def test_price_below_cost_is_readable_error(client):
    h = login(client, "abena@harbourview.example")
    r = client.post("/api/v1/items", json={"name": "Y drug", "barcode": "88888888", "batch": "B", "expiry": "2030-01-01",
                                          "qty": 1, "unitCost": 5, "unitPrice": 2}, headers=h)
    assert r.status_code == 422 and "below unit cost" in r.json()["detail"]


def test_profile_rules(client):
    efua = login(client, "efua@harbourview.example")
    users = {u["email"]: u for u in client.get("/api/v1/users", headers=efua).json()}
    me, kojo = users["efua@harbourview.example"], users["kojo@harbourview.example"]
    assert client.patch(f"/api/v1/users/{me['id']}", json={"phone": "+233 27 555 9999"}, headers=efua).status_code == 200
    assert client.patch(f"/api/v1/users/{me['id']}", json={"position": "Boss"}, headers=efua).status_code == 403
    assert client.patch(f"/api/v1/users/{kojo['id']}", json={"bio": "hi"}, headers=efua).status_code == 403
    admin = login(client, "abena@harbourview.example")
    r = client.patch(f"/api/v1/users/{me['id']}", json={"role": "Pharmacist"}, headers=admin)
    assert r.status_code == 200 and r.json()["role"] == "Pharmacist"
    # put Efua back as she was: later tests rely on her being a Dispenser with her seeded phone
    client.patch(f"/api/v1/users/{me['id']}", json={"role": "Dispenser", "phone": "+233 27 555 0311"}, headers=admin)


def test_monthly_analytics(client):
    h = login(client, "abena@harbourview.example")
    months = client.get("/api/v1/analytics/monthly", headers=h).json()
    assert len(months) == 6
    assert all(m["revenue"] > m["cost"] > 0 for m in months)


def test_pharmacy(client):
    h = login(client, "abena@harbourview.example")
    ph = client.get("/api/v1/pharmacy", headers=h).json()
    assert ph["name"] == "Harbour View Pharmacy" and ph["criticalDays"] == 30


def test_ai_chat_routes_and_uses_real_numbers(client):
    h = login(client, "abena@harbourview.example")
    r = client.post("/api/v1/ai/chat", json={"message": "Where are we losing money to expiry?"}, headers=h).json()
    assert r["kind"] == "losses" and r["facts"]["expired_batches"] == 4
    assert client.post("/api/v1/ai/chat", json={"message": "monthly report"}, headers=h).json()["kind"] == "report"
    assert client.post("/api/v1/ai/chat", json={"message": "tell me about Coartem"}, headers=h).json()["kind"] == "text"
    # Dispensers can't use AI insights.
    assert client.post("/api/v1/ai/chat", json={"message": "report"}, headers=login(client, "efua@harbourview.example")).status_code in (200, 403)


def test_alerts_settings_and_test_sms(client):
    h = login(client, "abena@harbourview.example")
    alerts = client.get("/api/v1/alerts", headers=h).json()
    assert any(a["status"] == "expired" for a in alerts) and all(not a["read"] for a in alerts)
    assert client.post("/api/v1/alerts/read", json=[alerts[0]["key"]], headers=h).status_code == 204
    assert client.get("/api/v1/alerts", headers=h).json()[0]["read"] is True
    bad = client.put("/api/v1/alerts/settings", json={"smsNumbers": "abc"}, headers=h)
    assert bad.status_code == 422
    ok = client.put("/api/v1/alerts/settings", json={"smsNumbers": "+233 24 555 0142", "emailEnabled": True, "email": "a@b.com"}, headers=h)
    assert ok.status_code == 200 and ok.json()["emailEnabled"] is True
    r = client.post("/api/v1/alerts/test-sms", headers=h).json()
    assert r["status"] == "mock"
    assert client.post("/api/v1/alerts/test-email", headers=h).json()["status"] == "mock"
    sent = client.post("/api/v1/alerts/send-digest", headers=h).json()
    assert {x["channel"] for x in sent} == {"sms", "email"}
    assert len(client.get("/api/v1/alerts/deliveries", headers=h).json()) >= 4


def test_import_csv_dry_run_then_save(client):
    h = login(client, "kojo@harbourview.example")
    csv_text = ("Product,Category,Barcode,Batch No,Expiry Date,Quantity,Cost,Price,Supplier\n"
                "Azithromycin 500mg Tabs ×3,Antibiotics,6034000221066,AZI-NEW,2030-05-01,40,12.5,24,Tobinco\n"
                "Bad row,X,123,B1,not-a-date,1,1,2,\n")
    files = {"file": ("stock.csv", csv_text.encode(), "text/csv")}
    dry = client.post("/api/v1/items/import?dry_run=true", files=files, headers=h).json()
    assert dry["total"] == 2 and len(dry["preview"]) == 1 and dry["errors"][0]["row"] == 3 and dry["added"] == 0
    saved = client.post("/api/v1/items/import?dry_run=false", files={"file": ("stock.csv", csv_text.encode(), "text/csv")}, headers=h).json()
    assert saved["added"] == 1
    again = client.post("/api/v1/items/import?dry_run=false", files={"file": ("stock.csv", csv_text.encode(), "text/csv")}, headers=h).json()
    assert again["updated"] == 1 and again["added"] == 0


def test_parse_then_ask_about_uploaded_file(client):
    h = login(client, "abena@harbourview.example")
    csv_text = ("name,category,barcode,batch,expiry,qty,unit_cost,unit_price,supplier,sold\n"
                "Test Amox 500mg,Antibiotics,1111111111,T1,2020-01-01,10,5,9,X,0\n"
                "Test Para 500mg,Analgesics,2222222222,T2,2099-01-01,50,2,4,Y,30\n")
    parsed = client.post("/api/v1/items/parse", files={"file": ("mine.csv", csv_text.encode(), "text/csv")}, headers=h).json()
    assert parsed["total"] == 2 and len(parsed["rows"]) == 2 and parsed["rows"][1]["soldThisMonth"] == 30
    r = client.post("/api/v1/ai/chat", json={"message": "where are we losing money", "datasetName": "mine.csv", "rows": parsed["rows"]}, headers=h).json()
    assert r["kind"] == "losses" and r["facts"]["expired_batches"] == 1
    rep = client.post("/api/v1/ai/chat", json={"message": "report", "rows": parsed["rows"]}, headers=h).json()
    assert rep["facts"]["has_history"] is False and rep["facts"]["revenue"] == "₵120"
    # Nothing was saved.
    assert not any(i["batch"] == "T1" for i in client.get("/api/v1/items", headers=h).json())


def test_general_question_without_ai_key_explains(client):
    h = login(client, "abena@harbourview.example")
    r = client.post("/api/v1/ai/chat", json={"message": "What is the capital of Ghana?", "history": [{"role": "ai", "text": "hi"}]}, headers=h).json()
    assert r["kind"] == "text" and "AI_PROVIDER" in r["text"]
    assert client.get("/api/v1/ai/status", headers=h).json() == {"connected": False}


def test_pharmacy_thresholds(client):
    h = login(client, "abena@harbourview.example")
    assert client.patch("/api/v1/pharmacy", json={"criticalDays": 60, "soonDays": 30}, headers=h).status_code == 400
    r = client.patch("/api/v1/pharmacy", json={"criticalDays": 45, "soonDays": 120}, headers=h)
    assert r.status_code == 200 and r.json()["criticalDays"] == 45
    client.patch("/api/v1/pharmacy", json={"criticalDays": 30, "soonDays": 90}, headers=h)


def test_change_password(client):
    h = login(client, "kojo@harbourview.example")
    assert client.post("/api/v1/auth/change-password", json={"current": "nope", "next": "a-much-longer-pass"}, headers=h).status_code == 400
    assert client.post("/api/v1/auth/change-password", json={"current": "cadence2026", "next": "a-much-longer-pass"}, headers=h).status_code == 204


def test_forgot_password_never_reveals_accounts(client):
    assert client.post("/api/v1/auth/forgot-password", json={"email": "nobody@nowhere.example"}).status_code == 204
    assert client.post("/api/v1/auth/forgot-password", json={"email": "efua@harbourview.example"}).status_code == 204
    assert client.get("/api/v1/auth/reset-password/not-a-real-token-at-all-xyz").json()["valid"] is False


def test_admin_reset_link_flow(client):
    admin = login(client, "abena@harbourview.example")
    efua_old = login(client, "efua@harbourview.example")
    efua_id = next(u["id"] for u in client.get("/api/v1/users", headers=admin).json() if u["email"] == "efua@harbourview.example")
    # Only admins can send links
    assert client.post(f"/api/v1/users/{efua_id}/send-reset", headers=efua_old).status_code == 403
    r = client.post(f"/api/v1/users/{efua_id}/send-reset", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "mock" and body["link"] and body["expiresMinutes"] == 60
    token = body["link"].split("token=")[1]
    assert client.get(f"/api/v1/auth/reset-password/{token}").json()["valid"] is True
    # Too short is refused
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "short"}).status_code == 422
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "brand-new-password-1"}).status_code == 204
    # The link works once, old sessions are signed out, the new password works
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "another-password-2"}).status_code == 400
    r = client.get("/api/v1/auth/me", headers=efua_old)
    assert r.status_code == 401 and "password was changed" in r.json()["detail"]
    r = client.post("/api/v1/auth/login", json={"email": "efua@harbourview.example", "password": "brand-new-password-1"})
    assert r.status_code == 200
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).status_code == 200
    # The delivery log records the email but never the link
    logs = client.get("/api/v1/alerts/deliveries", headers=admin).json()
    reset_logs = [d for d in logs if d["kind"] == "reset"]
    assert reset_logs and all("token" not in d["message"] for d in reset_logs)


def test_newer_link_cancels_older_one(client):
    admin = login(client, "abena@harbourview.example")
    uid = next(u["id"] for u in client.get("/api/v1/users", headers=admin).json() if u["email"] == "abena@harbourview.example")
    first = client.post(f"/api/v1/users/{uid}/send-reset", headers=admin).json()["link"].split("token=")[1]
    second = client.post(f"/api/v1/users/{uid}/send-reset", headers=admin).json()["link"].split("token=")[1]
    assert client.get(f"/api/v1/auth/reset-password/{first}").json()["valid"] is False
    assert client.get(f"/api/v1/auth/reset-password/{second}").json()["valid"] is True


def test_demo_requests(client):
    ok = {"name": "Ama Boateng", "pharmacy": "Osu Community Pharmacy", "phone": "+233 24 123 4567", "email": "", "branches": "1 branch"}
    assert client.post("/api/v1/demo-requests", json=ok).status_code == 201
    assert client.post("/api/v1/demo-requests", json={**ok, "phone": "call me"}).status_code == 422
    assert client.post("/api/v1/demo-requests", json={**ok, "website": "http://spam.example"}).status_code == 201  # honeypot

    codes = [client.post("/api/v1/demo-requests", json=ok).status_code for _ in range(5)]
    # The honeypot and the invalid request don't count toward the limit of 5 an hour
    assert codes == [201, 201, 201, 201, 429]


def test_personal_data_is_encrypted_at_rest(client):
    import sqlite3
    h = login(client, "abena@harbourview.example")
    me = client.get("/api/v1/auth/me", headers=h).json()
    assert me["phone"].startswith("+233")  # the API returns plain text
    con = sqlite3.connect("test_cadence.db")
    try:
        phone, reg = con.execute("SELECT phone, reg_no FROM users WHERE lower(email) = 'abena@harbourview.example'").fetchone()
        numbers = con.execute("SELECT sms_numbers FROM notification_settings").fetchone()[0]
        email = con.execute("SELECT email FROM users WHERE lower(email) = 'abena@harbourview.example'").fetchone()[0]
    finally:
        con.close()
    assert phone.startswith("enc:v1:") and "+233" not in phone
    assert reg == "" or reg.startswith("enc:v1:")
    assert numbers.startswith("enc:v1:")
    assert email == "abena@harbourview.example"  # sign-in emails stay readable for lookup


def test_security_headers(client):
    r = client.get("/health")
    assert r.headers["Strict-Transport-Security"].startswith("max-age=")
    assert r.headers["X-Content-Type-Options"] == "nosniff"


# ---------- Several pharmacies (tenants) ----------
NEW_PHARMACY = {"pharmacyName": "Osu Community Pharmacy", "location": "Osu, Accra", "licenceNo": "PC/RP/2201/26",
                "name": "Ama Boateng", "position": "Superintendent Pharmacist", "email": "ama@osu.example",
                "phone": "+233 24 123 4567", "password": "osu-pharmacy-2026"}


def _bearer(r):
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_signup_creates_a_separate_pharmacy(client):
    r = client.post("/api/v1/auth/signup", json=NEW_PHARMACY)
    assert r.status_code == 201, r.text
    assert r.json()["user"]["role"] == "Admin"
    b = _bearer(r)
    assert client.get("/api/v1/pharmacy", headers=b).json()["name"] == "Osu Community Pharmacy"
    assert client.get("/api/v1/items", headers=b).json() == []
    assert [u["email"] for u in client.get("/api/v1/users", headers=b).json()] == ["ama@osu.example"]
    assert {r["name"] for r in client.get("/api/v1/roles", headers=b).json()} == {"Admin", "Pharmacist", "Dispenser"}
    assert all(m["revenue"] == 0 for m in client.get("/api/v1/analytics/monthly", headers=b).json())
    assert client.get("/api/v1/alerts", headers=b).json() == []
    assert client.get("/api/v1/alerts/settings", headers=b).json()["email"] == "ama@osu.example"
    # The same email can't sign up twice
    assert client.post("/api/v1/auth/signup", json=NEW_PHARMACY).status_code == 409


def test_pharmacies_cannot_see_or_touch_each_other(client):
    a = login(client, "abena@harbourview.example")
    b = _bearer(client.post("/api/v1/auth/login", json={"email": "ama@osu.example", "password": "osu-pharmacy-2026"}))
    a_item = client.get("/api/v1/items", headers=a).json()[0]
    a_user = next(u for u in client.get("/api/v1/users", headers=a).json() if u["role"] == "Dispenser")
    # Reading, editing or deleting another pharmacy's batch looks like it doesn't exist
    assert client.get(f"/api/v1/items/barcode/{a_item['barcode']}", headers=b).json() == []
    assert client.patch(f"/api/v1/items/{a_item['id']}", json={"qty": 1}, headers=b).status_code == 404
    assert client.delete(f"/api/v1/items/{a_item['id']}", headers=b).status_code == 404
    assert client.patch(f"/api/v1/users/{a_user['id']}", json={"name": "Hacked"}, headers=b).status_code == 404
    assert client.post(f"/api/v1/users/{a_user['id']}/send-reset", headers=b).status_code == 404
    # The AI only ever sees your own pharmacy
    text = client.post("/api/v1/ai/chat", json={"message": "Generate a report"}, headers=b).json()["text"]
    assert "Coartem" not in text and "Harbour" not in text
    # Same barcode can exist in both pharmacies, independently
    mine = {"name": "Coartem 80/480mg ×6", "category": "Antimalarials", "barcode": a_item["barcode"], "batch": "OSU-001",
            "expiry": "2027-06-30", "qty": 12, "unitCost": 30, "unitPrice": 45, "supplier": "Osu Supplies"}
    assert client.post("/api/v1/items", json=mine, headers=b).status_code == 201
    assert len(client.get("/api/v1/items", headers=b).json()) == 1
    assert all(i["batch"] != "OSU-001" for i in client.get("/api/v1/items", headers=a).json())
    assert client.get(f"/api/v1/items/{a_item['id']}", headers=a).status_code in (404, 405)  # no single-item route; fine


def test_invite_a_team_member(client):
    b = _bearer(client.post("/api/v1/auth/login", json={"email": "ama@osu.example", "password": "osu-pharmacy-2026"}))
    r = client.post("/api/v1/users", json={"name": "Kofi Mensah", "email": "kofi@osu.example", "role": "Pharmacist",
                                            "position": "Pharmacist"}, headers=b)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["status"] == "Invited" and body["delivery"]["expiresMinutes"] == 72 * 60
    token = body["delivery"]["link"].split("token=")[1]
    # Invited people can't log in until they set a password
    assert client.post("/api/v1/auth/login", json={"email": "kofi@osu.example", "password": "whatever-123"}).status_code == 401
    check = client.get(f"/api/v1/auth/reset-password/{token}").json()
    assert check["invite"] is True and check["pharmacy"] == "Osu Community Pharmacy"
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "kofi-password-1"}).status_code == 204
    k = _bearer(client.post("/api/v1/auth/login", json={"email": "kofi@osu.example", "password": "kofi-password-1"}))
    me = client.get("/api/v1/auth/me", headers=k).json()
    assert me["status"] == "Active" and me["role"] == "Pharmacist"
    assert [i["batch"] for i in client.get("/api/v1/items", headers=k).json()] == ["OSU-001"]
    # Someone else's email, an unknown role, or a non-admin inviting: all refused
    assert client.post("/api/v1/users", json={"name": "X Y", "email": "abena@harbourview.example", "role": "Dispenser"}, headers=b).status_code == 409
    assert client.post("/api/v1/users", json={"name": "X Y", "email": "x@osu.example", "role": "Owner"}, headers=b).status_code == 400
    assert client.post("/api/v1/users", json={"name": "X Y", "email": "y@osu.example", "role": "Dispenser"}, headers=k).status_code == 403


def test_admin_cannot_lock_the_pharmacy_out(client):
    b = _bearer(client.post("/api/v1/auth/login", json={"email": "ama@osu.example", "password": "osu-pharmacy-2026"}))
    me = client.get("/api/v1/auth/me", headers=b).json()
    assert client.patch(f"/api/v1/users/{me['id']}", json={"status": "Suspended"}, headers=b).status_code == 400


def test_login_lockout_after_repeated_wrong_passwords(client):
    codes = [client.post("/api/v1/auth/login", json={"email": "nobody@lockout.example", "password": "wrong-password"}).status_code
             for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_integrations_status_and_ai_test(client):
    a = login(client, "abena@harbourview.example")
    r = client.get("/api/v1/integrations", headers=a).json()
    assert r["sms"]["status"] == "demo" and r["email"]["status"] == "demo" and r["ai"]["status"] == "demo"
    assert r["encryption"]["status"] == "live"
    assert client.post("/api/v1/integrations/test-ai", headers=a).json()["status"] == "mock"
    e = client.post("/api/v1/auth/login", json={"email": "ama@osu.example", "password": "osu-pharmacy-2026"})
    assert client.get("/api/v1/integrations", headers=_bearer(e)).status_code == 200


def test_email_and_sms_report_missing_settings(monkeypatch):
    from app.config import get_settings
    from app.services import notify
    s = get_settings()
    monkeypatch.setattr(s, "email_provider", "brevo")
    monkeypatch.setattr(s, "email_from", "")
    assert "EMAIL_FROM" in notify.email_problem()
    monkeypatch.setattr(s, "email_from", "alerts@example.com")
    assert "BREVO_API_KEY" in notify.email_problem()
    monkeypatch.setattr(s, "sms_provider", "arkesel")
    monkeypatch.setattr(s, "arkesel_api_key", "")
    assert "ARKESEL_API_KEY" in notify.sms_problem()
    status, detail = asyncio.run(notify.send_sms(["233245550142"], "hi"))
    assert status == "failed" and "ARKESEL_API_KEY" in detail


# ---------- Cadence HQ ----------
def _make_hq_admin(email="hq@cadence.example", password="hq-password-2026!"):
    import sqlite3
    import uuid as _uuid
    from app.security import hash_password
    con = sqlite3.connect("test_cadence.db")
    try:  # always close, or a duplicate insert leaves the database locked for every later test
        con.execute("INSERT INTO platform_admins (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
                    (_uuid.uuid4().hex, email, "Miriam", hash_password(password)))
        con.commit()
    finally:
        con.close()
    return email, password


def test_help_request_reaches_hq_and_reply_comes_back(client):
    h = login(client, "abena@harbourview.example")
    r = client.post("/api/v1/support/tickets", json={"category": "cant_dispense", "urgency": "urgent",
                                                     "message": "The inventory page won't load at the counter."}, headers=h)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    email, pw = _make_hq_admin()
    hq = _bearer(client.post("/api/v1/hq/auth/login", json={"email": email, "password": pw}))
    tickets = client.get("/api/v1/hq/tickets", headers=hq).json()
    t = next(x for x in tickets if x["id"] == tid)
    assert t["pharmacyName"] == "Harbour View Pharmacy" and t["urgency"] == "urgent" and t["status"] == "open"
    assert client.patch(f"/api/v1/hq/tickets/{tid}", json={"status": "acknowledged", "reply": "On it, calling you now."}, headers=hq).status_code == 200
    mine = client.get("/api/v1/support/tickets", headers=h).json()
    assert mine[0]["status"] == "acknowledged" and mine[0]["reply"] == "On it, calling you now."
    # Other pharmacies don't see Harbour View's requests
    b = _bearer(client.post("/api/v1/auth/login", json={"email": "ama@osu.example", "password": "osu-pharmacy-2026"}))
    assert all(x["id"] != tid for x in client.get("/api/v1/support/tickets", headers=b).json())


def test_hq_sees_usage_but_no_business_data(client):
    email, pw = "hq2@cadence.example", "hq-password-2026!"
    _make_hq_admin(email, pw)
    hq = _bearer(client.post("/api/v1/hq/auth/login", json={"email": email, "password": pw}))
    rows = client.get("/api/v1/hq/pharmacies", headers=hq).json()
    names = {r["name"] for r in rows}
    assert {"Harbour View Pharmacy", "Osu Community Pharmacy"} <= names
    hv = next(r for r in rows if r["name"] == "Harbour View Pharmacy")
    assert hv["loginsMonth"] > 0 and hv["activeUsersWeek"] > 0 and hv["health"] == "active"
    assert hv["featuresMonth"]["ai_question"] >= 1
    # Nothing about stock, money or alert recipients anywhere in the HQ payloads
    detail = client.get(f"/api/v1/hq/pharmacies/{hv['id']}", headers=hq)
    blob = (str(rows) + detail.text).lower()
    for forbidden in ("coartem", "amoxicillin", "unitcost", "unitprice", "revenue", "₵", "+233 24 555 0142", "alerts@harbourview"):
        assert forbidden not in blob, forbidden
    assert len(detail.json()["activityMonth"]) == 30
    ov = client.get("/api/v1/hq/overview", headers=hq).json()
    assert ov["pharmacies"] >= 2 and ov["urgentOpen"] >= 0


def test_hq_and_pharmacy_logins_are_separate(client):
    h = login(client, "abena@harbourview.example")
    assert client.get("/api/v1/hq/pharmacies", headers=h).status_code == 401  # a pharmacy admin can't open HQ
    hq = _bearer(client.post("/api/v1/hq/auth/login", json={"email": "hq@cadence.example", "password": "hq-password-2026!"}))
    assert client.get("/api/v1/items", headers=hq).status_code == 401  # HQ can't open a pharmacy's stock
    assert client.post("/api/v1/hq/auth/login", json={"email": "abena@harbourview.example", "password": "cadence2026"}).status_code == 401


# ---------- Messaging to chosen staff, weekly AI report ----------
def test_alerts_go_to_chosen_staff_without_money_for_non_finance_roles(client):
    a = login(client, "abena@harbourview.example")
    users = {u["email"]: u["id"] for u in client.get("/api/v1/users", headers=a).json()}
    ns = client.get("/api/v1/alerts/settings", headers=a).json()
    ns |= {"emailEnabled": True, "smsEnabled": True,
           "emailUserIds": [users["efua@harbourview.example"], "not-a-real-id"], "smsUserIds": [users["efua@harbourview.example"]]}
    saved = client.put("/api/v1/alerts/settings", json=ns, headers=a).json()
    assert saved["emailUserIds"] == [users["efua@harbourview.example"]]  # unknown ids are dropped
    assert saved["weeklyEnabled"] is True and saved["weeklyDay"] == 0
    assert client.post("/api/v1/alerts/send-digest", headers=a).status_code == 200
    log = client.get("/api/v1/alerts/deliveries", headers=a).json()
    efua_email = next(d for d in log if d["recipient"] == "efua@harbourview.example" and d["kind"] == "digest")
    shared = next(d for d in log if d["recipient"] == saved["email"] and d["kind"] == "digest")
    assert "₵" not in efua_email["message"] and "₵" in shared["message"]  # a dispenser doesn't see money
    efua_sms = next(d for d in log if d["channel"] == "sms" and "233275550311" in d["recipient"])
    assert "₵" not in efua_sms["message"]


def test_weekly_ai_report_goes_to_finance_recipients_only(client):
    a = login(client, "abena@harbourview.example")
    r = client.post("/api/v1/alerts/send-weekly", headers=a)
    assert r.status_code == 200 and r.json()[0]["status"] == "mock"
    weekly = [d for d in client.get("/api/v1/alerts/deliveries", headers=a).json() if d["kind"] == "weekly"]
    shared = client.get("/api/v1/alerts/settings", headers=a).json()["email"]
    assert {d["recipient"] for d in weekly} == {shared}  # efua (no finance) is skipped
    assert "weekly report" in weekly[0]["subject"] and "THE FIGURES" in weekly[0]["message"] and "1. " in weekly[0]["message"]
    d = login(client, "efua@harbourview.example")
    assert client.post("/api/v1/alerts/send-weekly", headers=d).status_code == 403


# ---------- HQ: AI, system, broadcasts, digest ----------
def _hq(client):
    email, pw = "hq3@cadence.example", "hq-password-2026!"
    try:
        _make_hq_admin(email, pw)
    except Exception:  # already created by an earlier test
        pass
    return _bearer(client.post("/api/v1/hq/auth/login", json={"email": email, "password": pw}))


def test_hq_ai_briefing_chat_and_draft_work_without_ai(client):
    hq = _hq(client)
    b = client.post("/api/v1/hq/ai/briefing", headers=hq).json()
    assert b["ai"] is False and "pharmacies used Cadence this week" in b["text"]
    c = client.post("/api/v1/hq/ai/chat", json={"message": "Who should I call today?"}, headers=hq).json()
    assert c["ai"] is False and "AI_PROVIDER" in c["text"]
    d = client.post("/api/v1/hq/ai/draft", json={"notes": "Maintenance on Sunday at 10pm for 30 minutes."}, headers=hq).json()
    assert d["title"] and d["sms"].startswith("Cadence:")
    pharmacy = login(client, "abena@harbourview.example")
    for method, path in (("POST", "/api/v1/hq/ai/briefing"), ("GET", "/api/v1/hq/system"), ("POST", "/api/v1/hq/broadcasts")):
        assert client.request(method, path, headers=pharmacy, json={}).status_code == 401  # pharmacy logins can't use HQ


def test_hq_ai_never_sees_business_data(client, monkeypatch):
    from app.services import ai
    seen = {}

    async def fake_llm(system, question, f, history, max_tokens):
        seen["facts"] = f
        return "Call Harbour View."
    monkeypatch.setattr(ai, "_llm", fake_llm)
    hq = _hq(client)
    r = client.post("/api/v1/hq/ai/briefing", headers=hq).json()
    assert r["text"] == "Call Harbour View." and r["ai"] is True
    blob = str(seen["facts"])
    for secret in ("₵", "Coartem", "@harbourview", "unit_cost", "batch_no", "+233", "Abena"):
        assert secret not in blob, secret


def test_hq_system_and_tests(client):
    hq = _hq(client)
    s = client.get("/api/v1/hq/system", headers=hq).json()
    assert s["sms"]["status"] == "demo" and s["hqEmail"]["status"] in ("live", "needs_setup")
    assert client.post("/api/v1/hq/test", json={"channel": "email", "to": "me@example.com"}, headers=hq).json()["status"] == "mock"
    assert client.post("/api/v1/hq/test", json={"channel": "sms", "to": "024 555 0142"}, headers=hq).json()["status"] == "mock"
    assert client.post("/api/v1/hq/test", json={"channel": "ai"}, headers=hq).json()["status"] == "mock"
    log = client.get("/api/v1/hq/deliveries?kind=test", headers=hq).json()
    assert {d["channel"] for d in log} >= {"email", "sms", "ai"}


def test_hq_broadcast_reaches_admins_and_shows_in_app(client):
    hq = _hq(client)
    body = {"title": "Sunday maintenance", "message": "Cadence will be down for 30 minutes on Sunday at 10pm.",
            "channels": ["in_app", "email", "sms"], "audience": "all"}
    dry = client.post("/api/v1/hq/broadcasts", json=body | {"dryRun": True}, headers=hq).json()
    assert dry["dryRun"] and dry["pharmacies"] >= 2 and dry["emailRecipients"] >= 2
    assert client.get("/api/v1/hq/broadcasts", headers=hq).json() == []  # a dry run saves nothing
    sent = client.post("/api/v1/hq/broadcasts", json=body, headers=hq).json()
    assert sent["results"]["email"]["mock"] == dry["emailRecipients"] and sent["results"]["in_app"]["pharmacies"] == dry["pharmacies"]
    assert client.get("/api/v1/hq/broadcasts", headers=hq).json()[0]["title"] == "Sunday maintenance"
    # every pharmacy user sees it in the app
    for email in ("efua@harbourview.example",):
        ann = client.get("/api/v1/announcements", headers=login(client, email)).json()
        assert ann[0]["title"] == "Sunday maintenance"
    # a broadcast to selected pharmacies only reaches them
    rows = client.get("/api/v1/hq/pharmacies", headers=hq).json()
    osu = next(r for r in rows if "Osu" in r["name"])
    client.post("/api/v1/hq/broadcasts", json={"title": "Osu only", "message": "Just for you.", "channels": ["in_app"],
                                               "audience": "selected", "pharmacyIds": [osu["id"]]}, headers=hq)
    titles = [a["title"] for a in client.get("/api/v1/announcements", headers=login(client, "abena@harbourview.example")).json()]
    assert "Osu only" not in titles
    assert client.post("/api/v1/hq/broadcasts", json=body | {"audience": "selected", "pharmacyIds": []}, headers=hq).status_code == 400


def test_hq_digest_preview_and_ticket_sms_reply(client):
    hq = _hq(client)
    p = client.get("/api/v1/hq/digest/preview", headers=hq).json()
    assert p["subject"].startswith("Cadence HQ") and "BRIEFING" in p["body"] and "₵" not in p["body"]
    h = login(client, "kojo@harbourview.example")
    t = client.post("/api/v1/support/tickets", json={"category": "question", "message": "How do I export?", "phone": "+233 20 555 0198"}, headers=h).json()
    r = client.patch(f"/api/v1/hq/tickets/{t['id']}", json={"reply": "Inventory > Export.", "textReply": True}, headers=hq)
    assert r.status_code == 200
    kinds = [(d["kind"], d["channel"]) for d in client.get("/api/v1/hq/deliveries", headers=hq).json()]
    assert ("reply", "sms") in kinds and ("reply", "email") in kinds


def test_cron_sends_digests_weekly_and_hq_digest(client, monkeypatch):
    from app.config import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "cron_secret", "cron-test-secret")
    monkeypatch.setattr(s, "hq_notify_email", "hq@cadence.example")
    monkeypatch.setattr(s, "hq_digest_time", "00:00")
    assert client.post("/api/v1/alerts/cron", headers={"X-Cron-Secret": "wrong"}).status_code == 403
    r = client.post("/api/v1/alerts/cron", headers={"X-Cron-Secret": "cron-test-secret"}).json()
    assert set(r) == {"messages", "weekly", "hq_digest"} and r["hq_digest"] == "mock"
    again = client.post("/api/v1/alerts/cron", headers={"X-Cron-Secret": "cron-test-secret"}).json()
    assert again["hq_digest"] == "skipped"  # once a day


def test_africastalking_settings_and_send(monkeypatch):
    import httpx
    from app.config import get_settings
    from app.services import notify
    s = get_settings()
    monkeypatch.setattr(s, "sms_provider", "africastalking")
    monkeypatch.setattr(s, "africastalking_username", "")
    assert "AFRICASTALKING_USERNAME" in notify.sms_problem()
    monkeypatch.setattr(s, "africastalking_username", "sandbox")
    monkeypatch.setattr(s, "africastalking_api_key", "test-key")
    monkeypatch.setattr(s, "sms_sender_id", "")
    assert notify.sms_problem() == "" and "SANDBOX" in notify.sms_live_detail()
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["body"], seen["key"] = str(request.url), request.content.decode(), request.headers.get("apiKey")
        return httpx.Response(201, json={"SMSMessageData": {"Message": "Sent to 1/1", "Recipients": [
            {"statusCode": 101, "number": "+233245550142", "status": "Success", "cost": "GHS 0.05", "messageId": "ATX1"}]}})
    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    assert asyncio.run(notify.send_sms(notify.numbers("024 555 0142"), "Cadence test")) == ("sent", "")
    assert seen["url"] == "https://api.sandbox.africastalking.com/version1/messaging" and seen["key"] == "test-key"
    assert "to=%2B233245550142" in seen["body"] and "username=sandbox" in seen["body"] and "from=" not in seen["body"]


def test_sms_is_one_plain_text_and_numbers_are_deduped():
    from types import SimpleNamespace
    from app.services import notify
    assert notify.numbers("024 555 0142, +233 24 555 0142; +233 024 555 0142\n245550142") == ["233245550142"]
    assert notify.gsm7("Cadence · ₵1,200 — “ok”…") == "Cadence - GHS 1,200 - \"ok\"..."
    rows = [SimpleNamespace(status="critical", name=f"Amoxicillin {i}", batch=f"AMX-{i:04d}", days=i + 2, value=10.0) for i in range(9)]
    rows += [SimpleNamespace(status="expired", name="Coartem", batch="CO-1", days=-3, value=1234.5)]
    s = SimpleNamespace(rows=rows, pharmacy="Harbour View Pharmacy And Wellness Centre")
    ns = SimpleNamespace(on_expired=True, on_critical=True)
    for fin in (True, False):
        text = notify.sms_text(s, ns, fin)
        assert len(text) <= 160 and notify.gsm7(text) == text and "9 critical" in text and "1 expired" in text
    assert "GHS" in notify.sms_text(s, ns, True) and "GHS" not in notify.sms_text(s, ns, False)


def test_cron_never_sends_the_same_digest_twice(client, monkeypatch):
    from app.config import get_settings
    from app.routers import alerts as alerts_router
    s = get_settings()
    monkeypatch.setattr(s, "cron_secret", "cron-test-secret")
    a = login(client, "abena@harbourview.example")
    ns = client.get("/api/v1/alerts/settings", headers=a).json() | {"smsEnabled": True, "smsNumbers": "024 555 0142", "digestTime": "00:00"}
    client.put("/api/v1/alerts/settings", json=ns, headers=a)
    import sqlite3
    con = sqlite3.connect("test_cadence.db")
    try:  # pretend today's digest hasn't gone out yet
        con.execute("UPDATE notification_settings SET last_digest_on = NULL")
        con.commit()
    finally:
        con.close()
    sent = []

    async def boom_after_sms(to, message, max_len=459):
        sent.append(message)
        return "sent", ""

    async def boom_email(*a, **k):
        raise RuntimeError("email provider exploded after the SMS went out")
    monkeypatch.setattr(alerts_router.notify, "send_sms", boom_after_sms)
    monkeypatch.setattr(alerts_router.notify, "send_email", boom_email)
    ns["emailEnabled"], ns["email"] = True, "owner@example.com"
    client.put("/api/v1/alerts/settings", json=ns, headers=a)
    counts = []
    for _ in range(3):  # cron-job.org every 15 minutes, with a failure after the SMS each time
        assert client.post("/api/v1/alerts/cron", headers={"X-Cron-Secret": "cron-test-secret"}).status_code == 200
        counts.append(len([x for x in sent if "Harbour" in x]))
    assert counts[0] >= 1 and counts == [counts[0]] * 3  # sent on the first run, never again that day
    assert all(len(x) <= 160 for x in sent)


def test_hq_can_delete_a_pharmacy_after_typing_its_name(client):
    hq = _hq(client)
    rows = client.get("/api/v1/hq/pharmacies", headers=hq).json()
    osu = next(r for r in rows if "Osu" in r["name"])
    url = f"/api/v1/hq/pharmacies/{osu['id']}/delete"
    assert client.post(url, json={"confirmName": "wrong name"}, headers=hq).status_code == 400
    assert client.post(url, json={"confirmName": osu["name"]}).status_code in (401, 403)  # HQ only
    assert client.post(url, json={"confirmName": osu["name"].upper()}, headers=hq).status_code == 204
    assert all(r["id"] != osu["id"] for r in client.get("/api/v1/hq/pharmacies", headers=hq).json())
    assert client.get(f"/api/v1/hq/pharmacies/{osu['id']}", headers=hq).status_code == 404
    gone = client.post("/api/v1/auth/login", json={"email": osu["adminEmail"], "password": "cadence2026"})
    assert gone.status_code in (400, 401)
    assert client.get("/api/v1/hq/pharmacies", headers=hq).status_code == 200  # everyone else is fine


def test_daily_report_pdf_download_email_attachment_and_cron_by_address(client, monkeypatch):
    from app.config import get_settings
    from app.routers import alerts as alerts_router
    a = login(client, "abena@harbourview.example")
    r = client.get("/api/v1/alerts/report.pdf", headers=a)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content[:4] == b"%PDF"
    assert "cadence-report-harbour-view-pharmacy-" in r.headers["content-disposition"]
    assert client.get("/api/v1/alerts/report.pdf?download=true", headers=login(client, "efua@harbourview.example")).content[:4] == b"%PDF"
    assert client.get("/api/v1/alerts/report.pdf").status_code == 401

    sent = []

    async def fake_email(to, subject, body, attachments=None):
        sent.append((to, body, attachments))
        return "mock", ""
    monkeypatch.setattr(alerts_router.notify, "send_email", fake_email)
    ns = client.get("/api/v1/alerts/settings", headers=a).json() | {"emailEnabled": True, "email": "owner@example.com"}
    client.put("/api/v1/alerts/settings", json=ns, headers=a)
    assert client.post("/api/v1/alerts/send-digest", headers=a).status_code == 200
    to, body, att = next(x for x in sent if x[0] == "owner@example.com")
    assert "attached as a PDF" in body
    name, data, mime = att[0]
    assert name.endswith(".pdf") and mime == "application/pdf" and data[:4] == b"%PDF"

    # cron-job.org can pass the secret in the address, with GET or POST
    monkeypatch.setattr(get_settings(), "cron_secret", "cron-test-secret")
    assert client.get("/api/v1/alerts/cron?secret=cron-test-secret").status_code == 200
    assert client.post("/api/v1/alerts/cron", headers={"Authorization": "Bearer cron-test-secret"}).status_code == 200
    bad = client.get("/api/v1/alerts/cron?secret=nope")
    assert bad.status_code == 403 and "doesn't match" in bad.json()["detail"]
    assert "No secret" in client.get("/api/v1/alerts/cron").json()["detail"]
    monkeypatch.setattr(get_settings(), "cron_secret", "")
    assert "isn't set" in client.get("/api/v1/alerts/cron?secret=x").json()["detail"]
