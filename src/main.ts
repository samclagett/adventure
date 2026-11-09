import './style.css';
import { supabase } from './zones/shared/supabase';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="card">
    <h1>Adventure</h1>
    <p>Conditions first, then pick the adventure. The 3D map arrives in the next step.</p>
    <div id="status" class="status">Checking connection…</div>
    <div id="auth"></div>
  </div>
`;

const statusEl = app.querySelector<HTMLDivElement>('#status')!;
const authEl = app.querySelector<HTMLDivElement>('#auth')!;

function setStatus(text: string, kind: 'ok' | 'warn') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function showSignedIn() {
  const { count, error } = await supabase!.from('hit_list').select('*', { count: 'exact', head: true });
  if (error) {
    setStatus(`Signed in, but the hit list table isn't reachable: ${error.message}`, 'warn');
  } else {
    setStatus(`Signed in. Hit list has ${count ?? 0} item(s).`, 'ok');
  }
  authEl.innerHTML = '';
}

function showSignIn() {
  setStatus('Connected to Supabase. Sign in with the shared login.', 'ok');
  authEl.innerHTML = `
    <form id="signin" style="margin-top:16px">
      <input name="email" type="email" placeholder="Email" autocomplete="username" required />
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
  `;
  authEl.querySelector<HTMLFormElement>('#signin')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const { error } = await supabase!.auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) setStatus(`Sign-in failed: ${error.message}`, 'warn');
    else await showSignedIn();
  });
}

async function start() {
  if (!supabase) {
    setStatus('Supabase isn\'t configured yet. See SETUP.md.', 'warn');
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) await showSignedIn();
  else showSignIn();
}

start();
