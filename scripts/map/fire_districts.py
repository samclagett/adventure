"""
Builds public/data/fire-districts.geojson: the NSW RFS fire weather districts as simple shapes, so the app can
tell which district each place is in and show that district's fire danger rating (2026-11-19).

The RFS feed (https://www.rfs.nsw.gov.au/feeds/fdrToban.xml) lists each district's councils. This joins those
council names to council boundaries from Overture Maps "division_area" (from OpenStreetMap, ODbL), merges
them per district and simplifies to about 800 m. Rerun if councils or districts change.

    pip install pyarrow shapely
    python scripts/map/fire_districts.py
"""
import json, os, re, sys, urllib.request
import pyarrow.dataset as ds
import pyarrow.fs as fs
import shapely
from shapely.geometry import mapping
from shapely.geometry.polygon import orient

RELEASE = '2026-10-21.0'
FEED = 'https://www.rfs.nsw.gov.au/feeds/fdrToban.xml'
TOLERANCE = 0.008  # degrees, about 800 m
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'data', 'fire-districts.geojson')


# Overture names that differ from the RFS list beyond the usual words.
ALIASES = {'nambucca valley council': 'nambucca', 'murrumbidgee council': 'northern parts murrumbidgee'}


def key(name: str) -> str:
    """Council names the way the RFS writes them: no "City Council", "Shire", "Regional" and so on."""
    n = name.lower()
    for prefix in ('the council of the shire of ', 'the council of the municipality of ', 'council of the city of ', 'city of '):
        n = n.replace(prefix, '')
    n = ALIASES.get(n, n)
    n = re.sub(r'\b(municipal|regional|shire|city|council|of)\b', ' ', n)
    n = n.replace('&', 'and').replace('-', ' ')
    return re.sub(r'\s+', ' ', n).strip()


req = urllib.request.Request(FEED, headers={'User-Agent': 'Mozilla/5.0 (adventure-app)'})
xml = urllib.request.urlopen(req, timeout=60).read().decode('utf-8')
districts = {}
for d in re.findall(r'<District>(.*?)</District>', xml, re.S):
    name = re.search(r'<Name>(.*?)</Name>', d).group(1)
    councils = re.search(r'<Councils>(.*?)</Councils>', d)
    for c in (councils.group(1).split(';') if councils else []):
        if c.strip():
            districts[key(c)] = name
print(len(set(districts.values())), 'districts,', len(districts), 'councils')

proxy = os.environ.get('HTTPS_PROXY')
s3 = fs.S3FileSystem(anonymous=True, region='us-west-2', **({'proxy_options': proxy} if proxy else {}))
d = ds.dataset(f'overturemaps-us-west-2/release/{RELEASE}/theme=divisions/type=division_area/', filesystem=s3, format='parquet')
t = d.to_table(columns=['names', 'geometry'], filter=(ds.field('country') == 'AU') & (ds.field('region') == 'AU-NSW') & (ds.field('subtype') == 'county'))
shapes: dict[str, list] = {}
missing = []
for names, wkb in zip(t.column('names').to_pylist(), t.column('geometry').to_pylist()):
    name = names['primary']
    district = districts.get(key(name))
    if not district:
        missing.append(name)
        continue
    shapes.setdefault(district, []).append(shapely.make_valid(shapely.from_wkb(wkb)))
print('Not in any district (islands, unincorporated):', ', '.join(sorted(set(missing))), file=sys.stderr)
unused = set(districts) - {key(n) for n in [nm['primary'] for nm in t.column('names').to_pylist()]}
if unused:
    print('RFS councils with no boundary found:', ', '.join(sorted(unused)), file=sys.stderr)

features = []
for name, geoms in sorted(shapes.items()):
    g = shapely.union_all(geoms).simplify(TOLERANCE, preserve_topology=True)
    polys = [p for p in getattr(g, 'geoms', [g]) if p.geom_type == 'Polygon' and p.area > 1e-5]
    g = shapely.MultiPolygon([orient(p) for p in polys])
    geo = mapping(g)
    geo['coordinates'] = [[[[round(x, 4), round(y, 4)] for x, y in ring] for ring in poly] for poly in geo['coordinates']]
    features.append({'type': 'Feature', 'properties': {'name': name}, 'geometry': geo})
with open(OUT, 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': features}, f, separators=(',', ':'))
print(len(features), 'districts written to', OUT, os.path.getsize(OUT) // 1024, 'KB')
