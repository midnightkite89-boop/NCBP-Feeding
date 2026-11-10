import { CENTRE } from '../centre';
import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  }

  return (
    <main className="login">
      <img src="/icon-192.png" alt="" width={96} height={96} />
      <h1>{CENTRE.appName}</h1>
      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="warn">{error}</p>}
        <button className="btn btn-primary btn-xl" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="muted">You'll stay signed in on this phone.</p>
    </main>
  );
}
