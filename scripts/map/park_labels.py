"""Make one label point per national park, so each name shows once, in the middle of the park.

Reads public/data/national-parks.geojson and writes public/data/park-labels.geojson.
For a park in several pieces it uses the biggest piece, and places the point at the spot
furthest from the edges ("pole of inaccessibility"), which is always inside the park.

Run it again whenever national-parks.geojson changes:
    pip install shapely
    python scripts/map/park_labels.py
"""
import json
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import polylabel

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "public/data/national-parks.geojson"
OUT = ROOT / "public/data/park-labels.geojson"

features = []
for f in json.loads(SRC.read_text())["features"]:
    name = f["properties"].get("name")
    if not name or not f.get("geometry"):
        continue
    geom = shape(f["geometry"])
    biggest = max(geom.geoms, key=lambda g: g.area) if geom.geom_type == "MultiPolygon" else geom
    point = polylabel(biggest, tolerance=0.001)
    features.append({
        "type": "Feature",
        # Area (in square degrees) lets the map show the big parks' names first.
        "properties": {"name": name, "area": round(geom.area, 5)},
        "geometry": {"type": "Point", "coordinates": [round(point.x, 5), round(point.y, 5)]},
    })

features.sort(key=lambda f: -f["properties"]["area"])
OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
print(f"Wrote {len(features)} park labels to {OUT.relative_to(ROOT)}")
