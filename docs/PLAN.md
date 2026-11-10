# Current plan: Stage 1

Agreed 2026-11-09. Tick items off here as they land.

1. ✅ **Repo and plumbing**: Vite + TypeScript app, zone folders, ZONES.md, CLAUDE.md, GitHub Pages deploy, Supabase hit list table and shared login.
2. ✅ **3D map**: MapLibre GL (chosen over Cesium: lighter on phones, simpler for AI to maintain) with free keyless terrain tiles. Australia ghosted, NSW, Victoria and Tasmania active, tap a state to zoom, light/full quality toggle, mountain-height slider, first pass at the stylised look.
3. ✅ **Hit list on the map**, built from scratch by adventure category (Sam's call, 2026-11-10: no existing list to import).
   Category filter chips (hiking, camping, beaches, surfing, climbing, skiing, snorkelling, diving, kayaking/canoeing,
   mountain biking, other), each with its own icon and colour. Add an adventure by picking a category, then searching a
   place (Nominatim, limited to NSW/ACT/VIC/TAS), tapping the map, or pasting a full Google Maps link. Items with no
   location go in the "To locate" list. Tap a pin for its card (notes, link, edit, delete). Saved to Supabase `hit_list`,
   category in the existing `activity` column. **Deferred:** bulk paste of a messy list.
4. **Conditions pipeline test**: "Get conditions" button triggers a GitHub Action that pulls Open-Meteo data for the pins and shows one simple callout bubble.
