import './style.css';
import { mountMap } from './zones/map';
import { mountHitList } from './zones/hitlist';
import { mountCampsites } from './zones/campsites';
import { supabase } from './zones/shared/supabase';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div id="map"></div>
  <div class="top-left">
    <header class="title-chip">Adventure</header>
    <details class="account" id="account">
      <summary><span id="status-dot" class="dot"></span><span id="status-short">Account</span></summary>
      <div class="account-body">
        <div id="status" class="status">Checking connection…</div>
        <div id="auth"></div>
      </div>
    </details>
  </div>
`;

const adv = mountMap(app.querySelector<HTMLDivElement>('#map')!);
mountHitList(app, adv);
mountCampsites(app, adv);

// ---- Account panel (Supabase shared login) ----

const statusEl = app.querySelector<HTMLDivElement>('#status')!;
const shortEl = app.querySelector<HTMLSpanElement>('#status-short')!;
const dotEl = app.querySelector<HTMLSpanElement>('#status-dot')!;
const authEl = app.querySelector<HTMLDivElement>('#auth')!;

function setStatus(text: string, kind: 'ok' | 'warn', short: string) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  shortEl.textContent = short;
  dotEl.className = `dot ${kind}`;
}

async function showSignedIn() {
  const { count, error } = await supabase!.from('hit_list').select('*', { count: 'exact', head: true });
  if (error) {
    setStatus(`Signed in, but the hit list table isn't reachable: ${error.message}`, 'warn', 'Signed in');
  } else {
    setStatus(`Signed in. Hit list has ${count ?? 0} item(s).`, 'ok', 'Signed in');
  }
  authEl.innerHTML = '';
}

function showSignIn() {
  setStatus('Connected to Supabase. Sign in with the shared login.', 'ok', 'Sign in');
  authEl.innerHTML = `
    <form id="signin">
      <input name="email" type="email" placeholder="Email" autocomplete="username" required />
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
  `;
  authEl.querySelector<HTMLFormElement>('#signin')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const { error } = await supabase!.auth.signInWithPassword({
      email: String(form.get('email')).trim(),
      password: String(form.get('password')),
    });
    if (error) setStatus(`Sign-in failed: ${error.message}`, 'warn', 'Sign in');
    else {
      await showSignedIn();
      (app.querySelector('#account') as HTMLDetailsElement).open = false;
    }
  });
}

async function start() {
  if (!supabase) {
    setStatus("Supabase isn't configured yet. See SETUP.md.", 'warn', 'Not set up');
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) await showSignedIn();
  else showSignIn();
}

start();
