"""
Turns Sam's reference images (refs/) straight into drawn/<name>.png, so the traced icon keeps the
example's exact shapes and proportions (Sam, 2026-11-17: "match the climbing, canyoning and kayaking
icons more closely"). The dark ink is kept, the background dropped, and the shape centred on a
400 px square, the size trace_icons.py expects.

    python scripts/icons/refs_to_drawn.py
    python scripts/icons/trace_icons.py 5
"""
from PIL import Image, ImageFilter
import numpy as np, os
HERE = os.path.dirname(os.path.abspath(__file__))
# name: (darkness cut-off, thinning) — climbing sits on a grey background, so its cut-off is lower.
REFS = {'climbing': (100, 0), 'canyoning': (150, 0), 'kayaking': (150, 0)}
SIZE, PAD = 400, 4
for name, (cut, thin) in REFS.items():
    im = Image.open(os.path.join(HERE, 'refs', name + '.png')).convert('RGBA')
    bg = Image.new('RGBA', im.size, 'white'); bg.alpha_composite(im)
    g = bg.convert('L')
    a = np.array(g) < cut
    ys, xs = np.nonzero(a)
    g = g.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    w, h = g.size; k = (SIZE - 2 * PAD) / max(w, h)
    g = g.resize((round(w * k), round(h * k)), Image.LANCZOS)
    ink = Image.fromarray(((np.array(g) < cut) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))
    ink = Image.fromarray(((np.array(ink) > 127) * 255).astype(np.uint8))
    if thin: ink = ink.filter(ImageFilter.MinFilter(thin))
    out = Image.new('L', (SIZE, SIZE), 255)
    out.paste(Image.fromarray(255 - np.array(ink)), ((SIZE - ink.width) // 2, (SIZE - ink.height) // 2))
    out.save(os.path.join(HERE, 'drawn', name + '.png'))
    print(name, ink.size)
