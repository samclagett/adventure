# Zone: hitlist

The adventure hit list: categories, pins on the map, adding/editing/deleting, the "to locate" queue,
place search (Nominatim), Google Maps link parsing, and saving to Supabase.

- `index.ts`: `mountHitList(parent, adv)`, the only thing other zones should import. Builds the "Hit list"
  button (top left) and "+" button, and the bottom sheet (list with category filter at the top, add/edit form, pin card).
  Pins follow the selected region; names show beside pins while a category is picked. Loads items once signed in.
- `categories.ts`: the category list (id, label, icon, muted accent colour). The id is saved in `hit_list.activity`,
  so don't rename ids that are in use. Merged ids go in `ALIASES` (snorkelling → diving); unknown values show as "Other".
- `icons.ts`: category icons from Sam's hand-drawn set, traced to SVG by `scripts/icons/trace_icons.py`
  (source image `scripts/icons/source-icons.png`). Small UI icons are Material Symbols (Apache 2.0). No emoji anywhere.
- `store.ts`: Supabase reads and writes for the `hit_list` table.
- `geocode.ts`: Nominatim search, limited to NSW/ACT/VIC/TAS. Only runs when Search is pressed (Nominatim's usage policy).
- `gmaps.ts`: pulls coordinates out of full Google Maps links or plain `lat, lng` text. Short `maps.app.goo.gl` links
  can't be expanded from a browser app, so the user is told to open them and copy the full link.
- `pins.ts`: MapLibre HTML markers, one per located item, plus a draggable draft pin while adding or editing.
- `hitlist.css`: styles for all of the above.

Items with `lat`/`lng` null are in the "To locate" list; tapping one opens the form to find it.
Bulk paste of a messy list is planned but not built yet.
