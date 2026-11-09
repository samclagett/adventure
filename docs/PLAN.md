# Current plan: Stage 1

Agreed 2026-11-09. Tick items off here as they land.

1. **Repo and plumbing**: Vite + TypeScript app, zone folders, ZONES.md, CLAUDE.md, GitHub Pages deploy, Supabase hit list table and shared login.
2. **3D map**: MapLibre GL (chosen over Cesium: lighter on phones, simpler for AI to maintain) with free keyless terrain tiles. Australia ghosted, NSW and Victoria active, tap a state to zoom, light/full quality toggle, first pass at the stylised look.
3. **Hit list on the map**: paste a messy list, geocode with Nominatim, "to locate" queue, drop pins or paste Google Maps links, saved to Supabase.
4. **Conditions pipeline test**: "Get conditions" button triggers a GitHub Action that pulls Open-Meteo data for the pins and shows one simple callout bubble.
