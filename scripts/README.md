# Behind-the-scenes scripts

Python scripts run by GitHub Actions on demand (for example when "Get conditions" is pressed).
Each zone that needs one gets its own folder, such as `scripts/conditions/`.
- `scripts/map/park_labels.py`: one label point per national park (run by hand when the parks data changes).
- `scripts/campsites/`: free-night checker for NSW National Parks campgrounds (campsites zone).
