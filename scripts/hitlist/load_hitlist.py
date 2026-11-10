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
import urllib.error
import urllib.request

FIELDS = ("name", "activity", "lat", "lng", "notes", "link")


def request(method, path, body=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
    headers = {"apikey": key, "Content-Type": "application/json", "Prefer": "return=representation"}
    # Older keys are JWTs ("eyJ...") and also go in Authorization; new "sb_secret_..." keys must not.
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method)) as res:
            return json.loads(res.read() or "null")
    except urllib.error.HTTPError as err:
        sys.exit(f"Supabase said {err.code}: {err.read().decode(errors='replace')[:500]}")


def main(paths):
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not key.isascii() or "*" in key or "." * 3 in key:
        sys.exit("The secret looks like the hidden (dotted) version of the key. Copy it again with Supabase's copy button.")
    if not os.environ.get("SUPABASE_URL") or not key:
        sys.exit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see SETUP.md step 5).")
    kind = "new secret key" if key.startswith("sb_secret_") else "legacy service_role JWT" if key.startswith("eyJ") else "unrecognised key type"
    print(f"Using {kind} ({len(key)} characters)")
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
