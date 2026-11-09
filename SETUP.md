# One-time setup

Do these once. They're clicks in web dashboards, not code.

## 1. Turn on GitHub Pages

In the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
After the next push to `main`, the site appears at https://samclagett.github.io/adventure/.

## 2. Create the Supabase project

1. Sign up at https://supabase.com (free) and create a new project. Pick the Sydney region.
2. In the project, open **SQL Editor**, paste the contents of [supabase/schema.sql](supabase/schema.sql) and click **Run**.
3. Create the shared login: **Authentication → Users → Add user → Create new user**. Use an email and a strong password,
   and tick **Auto Confirm User**. Share the password with your friend privately.
4. Stop strangers signing up: **Authentication → Sign In / Providers → turn off "Allow new users to sign up"**.

## 3. Give the app its Supabase settings

In Supabase, open **Project Settings → API** (or **Connect**) and copy the **Project URL** and the **anon / publishable key**.

In GitHub: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**, and add:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | the Project URL |
| `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |

These two are safe to be public; the data is protected by the login and row-level security.
Never paste the `service_role` / secret key anywhere in the repo.

Then re-run the deploy: **Actions → Deploy to GitHub Pages → Run workflow**.

## 4. Check it works

Open the live site on your phone. It should say "Connected to Supabase", let you sign in with the shared login,
and then show "Hit list has 0 item(s)."
