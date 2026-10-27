import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="hero" style={{ marginTop: '10vh' }}>
      <div className="pill">404</div>
      <h1>Page not found</h1>
      <p className="muted">That route doesn’t exist. Pick a project or go home.</p>
      <p style={{ marginTop: '1.25rem' }} className="row" >
        <Link className="btn primary" to="/" style={{ textDecoration: 'none' }}>
          Home
        </Link>
        <Link className="btn" to="/projects" style={{ textDecoration: 'none' }}>
          Projects
        </Link>
      </p>
    </div>
  );
}
