# Zone: campsites

Campsite data and the "Any free campsites?" availability hunt (Stage 3).

## How it works

1. **Which campgrounds:** every hit list item in the Camping category whose link is an NSW National Parks
   campground page (`https://www.nationalparks.nsw.gov.au/camping-and-accommodation/campgrounds/...`).
   The checker reads these links through the Supabase function `campsite_links()` (see `supabase/schema.sql`),
   which exposes only those links, nothing else from the hit list.
2. **The check:** `scripts/campsites/check.py`, run by `.github/workflows/campsites.yml` every 6 hours and on demand
   (Actions tab, "Check campsites", "Run workflow"). It opens each campground page in a headless browser, one at a
   time with a pause, and reads the list of free nights the page loads for its own calendar
   (`/npws/ReservationApi/AvailabilityDates`, dates as dd/mm/yyyy). A night is free when at least one site is open.
3. **The results:** `campsites.json` on the `campsite-data` branch (one commit, replaced each run), read by the app from
   raw.githubusercontent.com.
4. **The app:** `index.ts` adds the "Any free campsites?" button and panel, with a date window picker
   (this weekend, next 5 days, next week, next 2 weeks).

## Not checked automatically

- **Booderee (Cave Beach), Parks Australia:** its booking site's robots.txt asks bots to stay out, so it only gets a
  Book link. Don't add a scraper for it.
- **Parks Victoria:** not looked at yet.

## Ground rules

NSW National Parks' terms allow personal, non-commercial use and don't mention bots. Keep it that way: only the
campgrounds on our list, one page load each, no more often than the schedule. If the page changes and the check
breaks, the panel says "Couldn't check this one" and the Book link still works.
