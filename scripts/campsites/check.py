"""Campsite availability checker for NSW National Parks campgrounds.

Run by .github/workflows/campsites.yml. It:
  1. Asks Supabase for the park links of camping items on the hit list (the `campsite_links` function).
  2. Opens each NSW National Parks campground page in a headless browser, exactly as a visitor would,
     and reads the availability dates the page itself loads in the background.
  3. Writes campsites.json, which the workflow publishes to the `campsite-data` branch for the app.

Kept deliberately light: one page load per campground, one at a time, with a pause in between.
Only NSW National Parks pages are checked. Booderee (Parks Australia) asks bots to stay out, so it's skipped.

Environment: SUPABASE_URL, SUPABASE_ANON_KEY. Optional: OUT (default campsites.json).
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

import requests
from playwright.sync_api import sync_playwright

NSW_PREFIX = "https://www.nationalparks.nsw.gov.au/camping-and-accommodation/campgrounds/"
PAUSE_SECONDS = 5


def campground_links() -> list[str]:
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/campsite_links"
    key = os.environ["SUPABASE_ANON_KEY"]
    r = requests.post(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, json={}, timeout=30)
    r.raise_for_status()
    return sorted({row["link"] for row in r.json() if row["link"].startswith(NSW_PREFIX)})


def to_iso(day: str) -> str:
    """NSW Parks sends dates as dd/mm/yyyy."""
    return datetime.strptime(day, "%d/%m/%Y").date().isoformat()


def check(page, link: str) -> dict:
    """Load the campground page and catch the availability response it requests."""
    result = {"link": link, "free_nights": [], "error": None}
    try:
        with page.expect_response(lambda r: "/ReservationApi/AvailabilityDates" in r.url, timeout=45000) as info:
            page.goto(link, wait_until="domcontentloaded", timeout=45000)
        data = info.value.json()
        if data.get("Error"):
            result["error"] = data["Error"]
        result["free_nights"] = sorted(to_iso(d) for d in data.get("Dates") or [])
    except Exception as e:  # keep going with the other campgrounds
        result["error"] = f"Couldn't read availability: {type(e).__name__}"
    return result


def main() -> int:
    links = campground_links()
    print(f"Checking {len(links)} campground(s)")
    results = []
    with sync_playwright() as p:
        # CHROMIUM_PATH lets a local run reuse an installed Chromium; GitHub installs its own.
        browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
        page = browser.new_page()
        for i, link in enumerate(links):
            if i:
                time.sleep(PAUSE_SECONDS)
            r = check(page, link)
            print(f"  {link.removeprefix(NSW_PREFIX)}: {len(r['free_nights'])} free night(s){' ERROR ' + r['error'] if r['error'] else ''}")
            results.append(r)
        browser.close()

    out = {"checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "campgrounds": results}
    with open(os.environ.get("OUT", "campsites.json"), "w") as f:
        json.dump(out, f, indent=1)
    # Fail the run only if every campground failed, so one odd page doesn't hide the rest.
    return 1 if results and all(r["error"] for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
