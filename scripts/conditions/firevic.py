"""Victorian fire danger: reads the CFA's Total Fire Ban and Fire Danger Rating forecast (one feed, four days,
all nine fire weather districts) and saves a small fire-vic.json for the app. The CFA feed can't be read from
the browser (no CORS), so it's saved here every 3 hours with the forecasts. The NSW RFS feed is read live.

    {"fetched_at": "...", "days": [{"date": "2026-11-20", "ratings": {"Central": "MODERATE", ...},
                                     "bans": {"Central": false, ...}}, ...]}

Run by .github/workflows/conditions.yml. One request. Standard library only. Optional environment: OUT.
"""

import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

URL = "https://www.cfa.vic.gov.au/cfa/rssfeed/tfbfdrforecast_rss.xml"
MONTHS = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1)}


def main() -> int:
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (adventure-app, personal trip planner)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        xml = r.read().decode("utf-8-sig")
    days = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        title = re.search(r"<title>(.*?)</title>", item, re.S).group(1)
        d = re.search(r"(\d{1,2}) (\w+) (\d{4})", title)
        if not d:
            continue
        date = f"{d.group(3)}-{MONTHS[d.group(2)]:02d}-{int(d.group(1)):02d}"
        # The description is escaped HTML: "Central: NO - RESTRICTIONS MAY APPLY" (bans), then "Central: HIGH" (ratings).
        text = html.unescape(re.sub(r"<[^>]+>", "\n", html.unescape(re.search(r"<description>(.*?)</description>", item, re.S).group(1))))
        bans, ratings = {}, {}
        part = bans
        for line in (l.strip() for l in text.split("\n")):
            if line.startswith("Fire Danger Ratings"):
                part = ratings
                continue
            m = re.match(r"^([A-Z][A-Za-z ]+): (.+)$", line)
            if m and not m.group(1).startswith("Bureau"):
                part[m.group(1)] = m.group(2).strip()
        days.append({
            "date": date,
            "ratings": {k: v.upper() for k, v in ratings.items()},
            "bans": {k: v.upper().startswith("YES") for k, v in bans.items()},
        })
    if not days:
        print("No days found in the CFA feed", file=sys.stderr)
        return 1
    with open(os.environ.get("OUT", "fire-vic.json"), "w") as f:
        json.dump({"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "days": days}, f, separators=(",", ":"))
    print(f"Saved {len(days)} days of Victorian fire danger")
    return 0


if __name__ == "__main__":
    sys.exit(main())
