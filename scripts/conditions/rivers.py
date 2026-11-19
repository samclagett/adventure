"""River heights: reads the Bureau of Meteorology's "Latest River Heights" bulletins for NSW and Victoria and
saves every gauge's latest height, so the app can rate kayaking (and show canyon water levels) on them.

Run every 3 hours by .github/workflows/conditions.yml, after fetch.py. About a dozen pages, one request each,
a second apart. The app links each place to a gauge with its `settings.gauge` (the gauge's id below, e.g.
"IDN60233.563033" for the Colo River at Upper Colo); the levels that count as good live in the place's settings
too (see src/zones/conditions/rules.ts).

Standard library only. Optional environment: OUT (default rivers.json).
"""

import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Latest River Heights bulletins: NSW regions, then Victoria's river height bulletins.
BULLETINS = ["IDN60140", "IDN60141", "IDN60143", "IDN60144", "IDN60145", "IDN60146", "IDN60147", "IDN60148",
             "IDV60147", "IDV60148", "IDV60149", "IDV60150", "IDV60151"]
URL = "https://www.bom.gov.au/cgi-bin/wrap_fwo.pl?{}.html"
UA = "Mozilla/5.0 (adventure-app, personal trip planner; a few requests every 3 hours)"
SYDNEY = ZoneInfo("Australia/Sydney")
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("latin-1")


def text(cell: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", cell))).strip()


def when(stamp: str, now: datetime) -> str | None:
    """'07.45AM Fri' to an ISO time: the most recent Friday at 7:45am, Sydney time."""
    m = re.match(r"(\d{1,2})\.(\d{2})(AM|PM) (\w{3})", stamp)
    if not m or m.group(4) not in DAYS:
        return None
    h = int(m.group(1)) % 12 + (12 if m.group(3) == "PM" else 0)
    back = (now.weekday() - DAYS.index(m.group(4))) % 7
    t = (now - timedelta(days=back)).replace(hour=h, minute=int(m.group(2)), second=0, microsecond=0)
    if t > now + timedelta(hours=1):
        t -= timedelta(days=7)
    return t.isoformat()


def parse(page: str, now: datetime) -> dict:
    out = {}
    for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        link = re.search(r'href="/fwo/(ID[NV]\d+)/\1\.(\w+)\.tbl\.shtml"', row)
        cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if not link or len(cells) < 6:
            continue
        name, _kind, stamp, height, datum, trend = cells[:6]
        # The columns after the trend are the crossing level and the flood class; both usually blank.
        flood = next((c for c in cells[6:8] if c and "Plot" not in c), "")
        try:
            level = float(height)
        except ValueError:
            continue
        out[f"{link.group(1)}.{link.group(2)}"] = {
            "name": name,
            "level": level,
            "datum": datum,
            "trend": trend.lower() or None,
            "flood": flood or None,
            "at": when(stamp, now),
        }
    return out


def main() -> int:
    now = datetime.now(SYDNEY)
    gauges: dict = {}
    for b in BULLETINS:
        try:
            found = parse(get(URL.format(b)), now)
            gauges.update(found)
            print(f"{b}: {len(found)} gauges")
        except Exception as e:  # one region failing shouldn't lose the rest
            print(f"{b}: failed ({e})", file=sys.stderr)
        time.sleep(1)
    if not gauges:
        print("No river heights read", file=sys.stderr)
        return 1
    with open(os.environ.get("OUT", "rivers.json"), "w") as f:
        json.dump({"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "gauges": gauges}, f, separators=(",", ":"))
    print(f"Saved {len(gauges)} gauges")
    return 0


if __name__ == "__main__":
    sys.exit(main())
