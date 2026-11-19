"""Park closures: reads NSW National Parks alerts (the feed behind https://www.nationalparks.nsw.gov.au/alerts)
and keeps the closures and bushfire alerts, each with its map points, so the app can show a small alert icon
on places near them. The full feed is several MB; this saves a small parks.json.

Run every 3 hours by .github/workflows/conditions.yml. One request. Standard library only.
Optional environment: OUT (default parks.json).
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

# The alerts list the NPWS site loads (its id is fixed in the site's page).
URL = "https://api-prd.nswparks.cloud/api/v1/AlertsClosures/alerts/AD1E62CD-1182-456A-9397-EB08FF3EC793"
KEEP = {"Closure", "Bushfire"}


def main() -> int:
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (adventure-app, personal trip planner)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        alerts = json.load(r)["Alerts"]
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
    with open(os.environ.get("OUT", "parks.json"), "w") as f:
        json.dump({"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "alerts": out}, f, separators=(",", ":"))
    print(f"Saved {len(out)} closures and bushfire alerts of {len(alerts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
