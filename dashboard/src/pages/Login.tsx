import { useEffect, useState } from 'react';

export default function Login() {
  const [mode, setMode] = useState<'cloud' | 'local' | null>(null);
  const [auth, setAuth] = useState<'github' | 'open' | 'password'>('github');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { mode?: string; auth?: string }) => {
        setMode(h.mode === 'local' ? 'local' : 'cloud');
        setAuth((h.auth as typeof auth) || 'github');
        // Open local mode: reload so auto-session cookie from /api/me sticks
        if (h.mode === 'local' && h.auth === 'open') {
          window.location.href = '/';
        }
      })
      .catch(() => setMode('cloud'));
  }, []);

  async function localLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError((j as { error?: string }).error || 'Login failed');
        setBusy(false);
        return;
      }
      window.location.href = '/';
    } catch {
      setError('Could not reach server');
      setBusy(false);
    }
  }

  if (mode === null) {
    return (
      <div className="hero">
        <div className="muted">Starting Driftless…</div>
      </div>
    );
  }

  if (mode === 'local' && auth === 'password') {
    return (
      <div className="hero">
        <img className="hero-logo" src="/logo.svg" alt="Driftless" width={220} />
        <div className="pill">Local mode</div>
        <h1>Sign in to your local Driftless</h1>
        <p className="muted">This instance is password-protected on localhost.</p>
        <form onSubmit={localLogin} style={{ marginTop: '1.5rem', display: 'grid', gap: '0.75rem', maxWidth: 320 }}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Continue'}
          </button>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        </form>
      </div>
    );
  }

  if (mode === 'local') {
    return (
      <div className="hero">
        <img className="hero-logo" src="/logo.svg" alt="Driftless" width={220} />
        <div className="pill">Local mode</div>
        <h1>Opening local workspace…</h1>
        <p className="muted">No GitHub required. Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="hero">
      <img className="hero-logo" src="/logo.svg" alt="Driftless" width={220} />
      <div className="pill">Living docs for multi-repo teams</div>
      <h1>Keep docs in sync with the code</h1>
      <p className="muted">
        Driftless hosts shared markdown docs on Cloudflare, flags drift across repos, and gives every
        teammate&apos;s AI the same context over MCP.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <a className="btn primary" href="/oauth/github">
          Continue with GitHub
        </a>
      </p>
    </div>
  );
}
