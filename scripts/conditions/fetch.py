"""Conditions refresh: fetches Open-Meteo forecasts for every hit list area and saves them for the app.

Run every 3 hours by .github/workflows/conditions.yml (and by hand from the Actions tab). It:
  1. Asks Supabase for the forecast areas (the `conditions_areas` function): one point per 0.25 degree
     grid square that has hit list places, and whether any of them are coastal (surf, diving, kayaking).
  2. Fetches the weather forecast for every area, and hourly wind plus the marine forecast for coastal ones,
     many areas per request, exactly as the app does live (src/zones/conditions/openmeteo.ts).
  3. Writes conditions.json, which the workflow publishes to the `conditions-data` branch.

Standard library only. Environment: SUPABASE_URL, SUPABASE_ANON_KEY. Optional: OUT (default conditions.json).
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
TZ = "Australia/Sydney"
FORECAST_DAYS = 14
MARINE_DAYS = 8  # the marine API's limit
BATCH = 50
DAILY = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
         "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max",
         "wind_direction_10m_dominant", "snowfall_sum"]
WIND = ["wind_speed_10m", "wind_direction_10m"]
MARINE = ["wave_height", "swell_wave_height", "swell_wave_period", "swell_wave_direction",
          "sea_level_height_msl", "sea_surface_temperature"]


def get_json(url: str, data: bytes | None = None, headers: dict | None = None) -> object:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "adventure-conditions", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def areas() -> list[dict]:
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/conditions_areas"
    key = os.environ["SUPABASE_ANON_KEY"]
    return get_json(url, b"{}", {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})


def fetch(base: str, places: list[dict], params: dict) -> list[dict | None]:
    """Many places per request; if a batch fails, try its places one by one so the rest still work."""
    out: list[dict | None] = []
    for i in range(0, len(places), BATCH):
        batch = places[i:i + BATCH]
        try:
            out.extend(request(base, batch, params))
        except Exception as e:
            print(f"Batch failed ({e}), retrying one by one", file=sys.stderr)
            for p in batch:
                try:
                    out.extend(request(base, [p], params))
                except Exception as e2:
                    print(f"  {p['area']}: {e2}", file=sys.stderr)
                    out.append(None)
        time.sleep(1)
    return out


def request(base: str, places: list[dict], params: dict) -> list[dict]:
    q = {
        "latitude": ",".join(f"{p['lat']:.4f}" for p in places),
        "longitude": ",".join(f"{p['lng']:.4f}" for p in places),
        "timezone": TZ,
        "forecast_days": str(FORECAST_DAYS),
        **params,
    }
    body = get_json(f"{base}?{urllib.parse.urlencode(q)}")
    return body if isinstance(body, list) else [body]


def main() -> int:
    places = areas()
    coastal = [p for p in places if p["coastal"]]
    print(f"{len(places)} areas, {len(coastal)} coastal")
    weather = fetch(WEATHER_URL, places, {"daily": ",".join(DAILY)})
    wind = fetch(WEATHER_URL, coastal, {"hourly": ",".join(WIND)})
    marine = fetch(MARINE_URL, coastal, {"hourly": ",".join(MARINE), "forecast_days": str(MARINE_DAYS)})

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    result = {}
    for p, w in zip(places, weather):
        if w:
            result[p["area"]] = {"lat": p["lat"], "lng": p["lng"], "coastal": p["coastal"], "forecast": {"daily": w["daily"]}}
    for p, w, m in zip(coastal, wind, marine):
        f = result.get(p["area"], {}).get("forecast")
        if f is None:
            continue
        if w:
            f["hourlyWind"] = w["hourly"]
        if m:
            f["marine"] = m["hourly"]

    if not result:
        print("No forecasts fetched", file=sys.stderr)
        return 1
    with open(os.environ.get("OUT", "conditions.json"), "w") as f:
        json.dump({"fetched_at": now, "areas": result}, f, separators=(",", ":"))
    print(f"Saved {len(result)} areas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
