"""Check a deployed Cadence API from your computer.

    python -m app.smoke https://cadence-api.onrender.com https://your-site.vercel.app

Checks the API answers, the database is reachable, the website is allowed to call it (CORS), the security
headers are on, and the AI/SMS/email settings via an admin login if you give one:

    python -m app.smoke API_URL SITE_URL admin@yourpharmacy.com
"""
import getpass
import sys

import httpx


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    api, site = sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/")
    ok = True

    def check(label: str, passed: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= passed
        print(f"{'✓' if passed else '✗'} {label}{(': ' + detail) if detail else ''}")

    with httpx.Client(timeout=90) as c:  # the free plan sleeps; the first call can take ~50 s
        r = c.get(f"{api}/health")
        check("API and database answer /health", r.status_code == 200 and r.json().get("status") == "ok", f"{r.status_code} {r.text[:80]}")
        check("HTTPS-only header (HSTS)", "strict-transport-security" in r.headers)
        pre = c.options(f"{api}/api/v1/auth/login", headers={"Origin": site, "Access-Control-Request-Method": "POST",
                                                             "Access-Control-Request-Headers": "content-type"})
        allowed = pre.headers.get("access-control-allow-origin")
        check(f"Website {site} may call the API (CORS)", allowed in (site, "*"),
              "add it to ALLOWED_ORIGINS on Render" if allowed not in (site, "*") else "")
        s = c.get(site)
        check("Website loads", s.status_code == 200, str(s.status_code))
        check("Website sends a Content-Security-Policy", "content-security-policy" in s.headers)
        if len(sys.argv) > 3:
            pw = getpass.getpass(f"Password for {sys.argv[3]}: ")
            lr = c.post(f"{api}/api/v1/auth/login", json={"email": sys.argv[3], "password": pw})
            check("Admin can log in", lr.status_code == 200, lr.text[:120] if lr.status_code != 200 else "")
            if lr.status_code == 200:
                h = {"Authorization": f"Bearer {lr.json()['access_token']}"}
                integ = c.get(f"{api}/api/v1/integrations", headers=h).json()
                for name, row in integ.items():
                    check(f"{name}: {row['status']}", row["status"] != "needs_setup", row["detail"])
    print("\nAll good." if ok else "\nFix the ✗ items above, then run this again.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
