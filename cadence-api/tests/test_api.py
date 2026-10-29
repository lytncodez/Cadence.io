"""End-to-end API tests on a throwaway SQLite database.  Run:  pytest -q"""
import asyncio
import os

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_cadence.db"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["SEED_PASSWORD"] = "cadence2026"

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
    r = client.post("/api/v1/auth/login", json={"email": email, "password": "cadence2026"})
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


def test_monthly_analytics(client):
    h = login(client, "abena@harbourview.example")
    months = client.get("/api/v1/analytics/monthly", headers=h).json()
    assert len(months) == 6
    assert all(m["revenue"] > m["cost"] > 0 for m in months)


def test_pharmacy(client):
    h = login(client, "abena@harbourview.example")
    ph = client.get("/api/v1/pharmacy", headers=h).json()
    assert ph["name"] == "Harbour View Pharmacy" and ph["criticalDays"] == 30


def test_change_password(client):
    h = login(client, "kojo@harbourview.example")
    assert client.post("/api/v1/auth/change-password", json={"current": "nope", "next": "a-much-longer-pass"}, headers=h).status_code == 400
    assert client.post("/api/v1/auth/change-password", json={"current": "cadence2026", "next": "a-much-longer-pass"}, headers=h).status_code == 204
