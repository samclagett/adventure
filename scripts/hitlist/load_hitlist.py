"""
Loads hit list items from a JSON file into the Supabase `hit_list` table.

Run by .github/workflows/load-hitlist.yml whenever a file in data/hitlist/ changes (or by hand from
the Actions tab). Needs two environment variables, both set by the workflow:
  SUPABASE_URL               the project URL (repo variable VITE_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY  the secret admin key (GitHub Actions secret, never in the repo)

Each JSON file is a list of {"name", "activity", "lat", "lng", "notes", "link"} objects.
Safe to re-run: an item whose name and activity already exist is skipped, never duplicated.
Uses only the Python standard library.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

FIELDS = ("name", "activity", "lat", "lng", "notes", "link")


def request(method, path, body=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method)) as res:
        return json.loads(res.read() or "null")


def main(paths):
    existing = request("GET", "hit_list?select=name,activity")
    seen = {(r["name"].strip().lower(), (r["activity"] or "").lower()) for r in existing}
    print(f"{len(existing)} items already in the hit list")
    total = 0
    for path in paths:
        items = json.load(open(path, encoding="utf-8"))
        new = []
        for item in items:
            key = (item["name"].strip().lower(), (item.get("activity") or "").lower())
            if key in seen:
                print(f"  skip (already there): {item['name']} [{item.get('activity')}]")
                continue
            seen.add(key)
            new.append({f: item.get(f) for f in FIELDS})
        if new:
            request("POST", "hit_list", new)
        print(f"{path}: added {len(new)}, skipped {len(items) - len(new)}")
        total += len(new)
    print(f"Done. Added {total} item(s).")


if __name__ == "__main__":
    files = sys.argv[1:] or sorted(os.path.join("data/hitlist", f) for f in os.listdir("data/hitlist") if f.endswith(".json"))
    main(files)
