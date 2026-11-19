"""Park closures and bushfires near places, saved as a small parks.json for the app's alert icons.

- NSW: National Parks alerts (the feed behind https://www.nationalparks.nsw.gov.au/alerts): closures and bushfires,
  each with its map points. The full feed is several MB.
- VIC: Parks Victoria has no feed, so this reads the "change of conditions" notices on the page of each park in
  VIC_PARKS (one page every 2 seconds) and keeps the closures. Each counts for places within the park's radius.
  Add a park here when a Victorian place is added to the hit list.
- VIC: bushfires that aren't yet safe, from VicEmergency (https://emergency.vic.gov.au/public/events-geojson.json).

Each part runs on its own, so one source failing doesn't lose the others.
Run every 3 hours by .github/workflows/conditions.yml. Standard library only. Optional environment: OUT.
"""

import json
import os
import html
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

# The alerts list the NPWS site loads (its id is fixed in the site's page).
URL = "https://api-prd.nswparks.cloud/api/v1/AlertsClosures/alerts/AD1E62CD-1182-456A-9397-EB08FF3EC793"
KEEP = {"Closure", "Bushfire"}
UA = {"User-Agent": "Mozilla/5.0 (adventure-app, personal trip planner)"}

PV = "https://www.parks.vic.gov.au/places-to-see/parks/"
# Victorian parks near hit list places: page name, centre [lat, lng], and how far (km) from it a place counts.
VIC_PARKS = {
    "mount-arapiles-tooan-state-park": ([-36.757, 141.831], 8),
    "grampians-national-park": ([-37.15, 142.45], 40),
    "great-otway-national-park": ([-38.70, 143.55], 40),
    "mornington-peninsula-national-park": ([-38.45, 144.85], 20),
    "cathedral-range-state-park": ([-37.40, 145.75], 8),
    "wilsons-promontory-national-park": ([-39.03, 146.35], 25),
    "mount-buffalo-national-park": ([-36.73, 146.79], 15),
    "alpine-national-park": ([-36.95, 147.20], 40),
    "barmah-national-park": ([-35.98, 145.00], 20),
    "snowy-river-national-park": ([-37.25, 148.40], 30),
    "cape-conran-coastal-park": ([-37.80, 148.73], 10),
    "croajingolong-national-park": ([-37.70, 149.40], 50),
}
VIC_EVENTS = "https://emergency.vic.gov.au/public/events-geojson.json"


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def text(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", s)).strip()


def vic_parks() -> list:
    out = []
    for i, (slug, (centre, km)) in enumerate(VIC_PARKS.items()):
        if i:
            time.sleep(2)
        page = get(PV + slug).decode("utf-8", "replace")
        t = re.search(r"<title>(.*?)</title>", page, re.S)
        park = text(t.group(1)) if t else slug.replace("-", " ").title()
        site, seen = "", set()
        for m in re.finditer(r'<h4 class="change-of-conditions__subtitle">(.*?)</h4>|<h3 class="change-of-conditions__title[^"]*">\s*<span[^>]*>(.*?)</span>', page, re.S):
            if m.group(1):
                site = text(m.group(1))
                continue
            title = text(m.group(2))
            # Closures only, and not a toilet on its own.
            if not re.search(r"clos", title, re.I) or (re.search(r"toilet", title, re.I) and not re.search(r"camp", title, re.I)):
                continue
            if title.lower() in seen:
                continue
            seen.add(title.lower())
            where = re.sub(r"\s*\(.*\)$", "", site)
            if site.startswith("Notices Affecting") or where in park or where.lower() in title.lower():
                where = ""
            out.append({"type": "Closure", "title": title, "where": where, "park": park, "link": PV + slug,
                        "start": None, "end": None, "points": [centre], "km": km})
    return out


def vic_fires() -> list:
    out = []
    for f in json.loads(get(VIC_EVENTS))["features"]:
        p = f["properties"]
        g = f.get("geometry") or {}
        if p.get("category2") != "Bushfire" or p.get("status") == "Safe" or g.get("type") != "Point":
            continue
        lng, lat = g["coordinates"][:2]
        out.append({"type": "Bushfire", "title": f"Bushfire, {p.get('status', '').lower()}", "where": (p.get("location") or "").title(),
                    "park": "", "link": "https://emergency.vic.gov.au/respond/", "start": None, "end": None,
                    "points": [[round(lat, 4), round(lng, 4)]], "km": 10})
    return out


def nsw() -> list:
    alerts = json.loads(get(URL))["Alerts"]
    out = []
    for a in alerts:
        # Upcoming ones too: the app shows each on the dates it covers.
        if a.get("Type") not in KEEP:
            continue
        park = re.search(r"\[([^\]]+)\]\((/visit-a-park/[^)]+)\)", a.get("LocationDetail") or "")
        ends = [t.get("EndDateTimeUtc") for t in a.get("AlertDateTimes") or [] if t.get("EndDateTimeUtc")]
        starts = [t.get("StartDateTimeUtc") for t in a.get("AlertDateTimes") or [] if t.get("StartDateTimeUtc")]
        out.append({
            "type": a["Type"],
            "title": a.get("Title") or a["Type"],
            "where": (a.get("SpatialSummary") or "").strip(),
            "park": park.group(1) if park else "",
            "link": f"https://www.nationalparks.nsw.gov.au{park.group(2)}" if park else "https://www.nationalparks.nsw.gov.au/alerts",
            "start": min(starts) if starts else None,
            "end": max(ends) if ends else None,
            "points": [[round(p["lat"], 4), round(p["lng"], 4)] for p in a.get("PointsJson") or []][:20],
        })
    return out


def main() -> int:
    out = []
    for name, part in (("NSW parks", nsw), ("VIC parks", vic_parks), ("VIC bushfires", vic_fires)):
        try:
            got = part()
            out += got
            print(f"{name}: {len(got)}")
        except Exception as e:  # noqa: BLE001  one source down shouldn't lose the others
            print(f"{name} failed: {e}", file=sys.stderr)
    if not out:
        return 1
    with open(os.environ.get("OUT", "parks.json"), "w") as f:
        json.dump({"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "alerts": out}, f, separators=(",", ":"))
    print(f"Saved {len(out)} closures and bushfire alerts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
