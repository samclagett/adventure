"""
Traces Sam's hand-drawn icon sheet (source-icons.png, 8 icons in a row) into SVG paths.

    pip install pillow numpy potracer
    python scripts/icons/trace_icons.py 5

The number thickens the lines (5 = the weight used in the app, 0 = original). Writes paths<N>.json;
copy each path into src/zones/hitlist/icons.ts. Icon order: hiking, camping, surfing, climbing,
skiing, diving, kayaking, other. Skis and the mask touch, so they're split by hand-tuned rules below.
"""
from PIL import Image, ImageFilter
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
THICK=int(sys.argv[1]) if len(sys.argv)>1 else 0
import numpy as np, potrace, json
im=Image.open(os.path.join(HERE, 'source-icons.png')).convert('L')
a=np.array(im).astype(float)
dark=a<150
col=dark.sum(0)
xs=np.where(col>0)[0]
# group columns
groups=[[xs[0],xs[0]]]
for x in xs[1:]:
    if x-groups[-1][1]<45: groups[-1][1]=x
    else: groups.append([x,x])
# split skis/mask group at largest gap
g=groups[4]; lo=g[0]+(g[1]-g[0])*0.3; hi=g[0]+(g[1]-g[0])*0.7
seg=col[int(lo):int(hi)]; cut=int(lo)+int(seg.argmin()); print('cut',g,cut,seg.min())
groups[4:5]=[[g[0],cut+30],[cut+1,g[1]]]
SKI_CUT=cut
names=['hiking','camping','surfing','climbing','skiing','diving','kayaking','other']
assert len(groups)==8, groups
out={}
H=dark.shape[0]
for name,(x0,x1) in zip(names,groups):
    crop=dark[:,x0:x1+1].copy()
    if name=='skiing': crop[:int(H*0.8), SKI_CUT-x0+1:]=False
    if name=='diving': crop[int(H*0.62):, :31]=False
    if THICK: crop=np.array(Image.fromarray(crop.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(THICK)))>0
    rows=np.where(crop.any(1))[0]; y0,y1=rows[0],rows[-1]
    w=x1-x0+1; h=y1-y0+1; side=max(w,h); pad=int(side*0.04); side+=2*pad
    # square canvas
    canvas=np.zeros((side,side),bool)
    ox=(side-w)//2; oy=(side-h)//2
    canvas[oy:oy+h,ox:ox+w]=crop[y0:y1+1]
    # remove specks: drop tiny components via simple erosion-free approach: potrace turdsize
    bm=potrace.Bitmap(~canvas)
    plist=bm.trace(turdsize=8, alphamax=1.0, opticurve=True, opttolerance=0.3)
    s=96/side; d=[]
    f=lambda p:f'{p.x*s:.2f} {p.y*s:.2f}'
    for c in plist:
        d.append('M'+f(c.start_point))
        for seg in c.segments:
            if seg.is_corner: d.append('L'+f(seg.c)+' L'+f(seg.end_point))
            else: d.append('C'+f(seg.c1)+' '+f(seg.c2)+' '+f(seg.end_point))
        d.append('Z')
    out[name]=' '.join(d)
    print(name, side, len(out[name]))
json.dump(out, open(os.path.join(HERE, f'paths{THICK}.json'), 'w'), indent=1)
