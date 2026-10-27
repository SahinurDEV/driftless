export default function Login() {
  return (
    <div className="hero">
      <img src="/logo-dark.svg" alt="Driftless" width={220} style={{ marginBottom: '1.25rem' }} />
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
