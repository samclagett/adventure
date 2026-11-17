"""
Builds public/data/ocean.geojson: the sea around NSW, Victoria and Tasmania as one crisp vector shape,
so the map's coastline is sharp at every zoom instead of following the blocky elevation tiles (2026-11-17).

Source: Overture Maps "land" and "water" (from OpenStreetMap, ODbL), read straight from Overture's public
S3 bucket. Ocean = the box around the three states minus all land, plus the harbours, estuaries, bays and
river mouths that open onto it (Overture counts Sydney Harbour as land with a water shape on top), simplified to about 13 m, islands
smaller than about 1,500 m² dropped, rings oriented the GeoJSON way (outer anticlockwise).

    pip install pyarrow shapely
    python scripts/map/ocean.py            # about a minute; downloads only the matching row groups
"""
import json, os, re
import pyarrow.dataset as ds
import pyarrow.fs as fs
import shapely
from shapely.geometry import box, mapping
from shapely.geometry.polygon import orient

RELEASE = '2026-10-21.0'
BOX = (140.9, -44.0, 154.0, -28.0)
TOLERANCE = 0.00012  # degrees, about 13 m
MIN_AREA = 1.5e-7    # square degrees, about 1,500 m²
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'data', 'ocean.geojson')

proxy = os.environ.get('HTTPS_PROXY')
s3 = fs.S3FileSystem(anonymous=True, region='us-west-2', **({'proxy_options': proxy} if proxy else {}))
x0, y0, x1, y1 = BOX
inside = lambda: (ds.field('bbox', 'xmin') < x1) & (ds.field('bbox', 'xmax') > x0) & (ds.field('bbox', 'ymin') < y1) & (ds.field('bbox', 'ymax') > y0)


def shapes(kind, f):
    d = ds.dataset(f'overturemaps-us-west-2/release/{RELEASE}/theme=base/type={kind}/', filesystem=s3, format='parquet')
    t = d.to_table(columns=['geometry'], filter=inside() & f)
    return [g for g in shapely.from_wkb(t.column('geometry').to_pylist()) if g.geom_type in ('Polygon', 'MultiPolygon')]


geoms = shapes('land', ds.field('class').isin(['land', 'island', 'islet']))
print(len(geoms), 'land shapes')
# Water that can join the sea: harbours and estuaries (plain "water"), rivers, bays and lagoons, if big enough.
water = [g for g in shapes('water', ds.field('class').isin(['water', 'river', 'bay', 'lagoon', 'strait'])) if g.area > 2e-6]
print(len(water), 'water shapes')

land = shapely.union_all(shapely.make_valid(geoms))
area = box(*BOX)
sea = area.difference(land.intersection(area))
# Add water shapes that touch the sea, and the ones touching those (a harbour's upstream reaches), found
# with a spatial index so it stays quick.
water = list(shapely.make_valid(water))
tree = shapely.STRtree(water)
coast = shapely.buffer(sea.boundary, 0.0003)
todo = [int(i) for i in tree.query(coast, predicate='intersects')]
seen = set(todo)
while todo:
    i = todo.pop()
    for j in tree.query(shapely.buffer(water[i], 0.0002), predicate='intersects'):
        j = int(j)
        if j not in seen:
            seen.add(j)
            todo.append(j)
print('joined', len(seen), 'water shapes to the sea')
sea = shapely.union_all([sea, *[water[i] for i in seen]])
ocean = shapely.simplify(sea, TOLERANCE, preserve_topology=True)
parts = list(ocean.geoms) if ocean.geom_type == 'MultiPolygon' else [ocean]
keep = []
for p in parts:
    if p.area < MIN_AREA:
        continue
    holes = [h for h in p.interiors if shapely.Polygon(h).area >= MIN_AREA]
    keep.append(orient(shapely.Polygon(p.exterior, holes), sign=1.0))
ocean = shapely.MultiPolygon(keep)

text = json.dumps({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': mapping(ocean)}]}, separators=(',', ':'))
text = re.sub(r'(\d+\.\d{5})\d+', r'\1', text)
with open(OUT, 'w') as fh:
    fh.write(text)
print(f'{len(text) / 1e6:.1f} MB, {shapely.get_num_coordinates(ocean)} points ->', OUT)
