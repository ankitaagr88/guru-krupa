import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { USE_MOCKS } from '../../api';
import { HOSPITAL_NAME, DOCTOR_NAME } from '../../nav';
import './login.css';

/* Login (F1). Calls auth.login, stores the session via AuthContext and
   redirects to where the user was going (or /queue). Navy ground (the
   navigation's own), the clinic's logo and name in the serif, one sapphire
   button. */
export default function Login() {
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const params = new URLSearchParams(location.search);
  const next = location.state?.from?.pathname || params.get('next') || '/queue';

  if (!loading && isAuthenticated)
    return <Navigate to={next.startsWith('/login') ? '/queue' : next} replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      navigate(next.startsWith('/login') ? '/queue' : next, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page gk-on-navy">
      <div className="login-wrap">
        <div className="login-hero">
          <div className="login-logo">
            <img src="/logo.png" alt="Guru Krupa Eye Hospital & Laser Center" />
          </div>
          <div className="login-hero-text">
            <span className="login-eyebrow">Clinic app</span>
            <h1>{HOSPITAL_NAME}</h1>
            <p>{DOCTOR_NAME} · Vesu, Surat</p>
          </div>
        </div>

        <form className="login-card" onSubmit={submit} noValidate>
          <div className="login-brand">
            <h1>Staff sign in</h1>
            <p>Queue, OT, stock and prescriptions — one sign-in for the whole clinic</p>
          </div>

          <label htmlFor="username">Username</label>
          <input
            id="username"
            className={`fake-input${error ? ' error' : ''}`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            disabled={busy}
          />
          <label htmlFor="password">Password</label>
          <div className="login-pw">
            <input
              id="password"
              type={showPw ? 'text' : 'password'}
              className={`fake-input${error ? ' error' : ''}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
            <button
              type="button"
              className="login-pw-toggle"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="login-foot">
            {USE_MOCKS ? (
              <>
                Demo data — try <b>admin / admin</b>, <b>doctor / doctor</b>, <b>reception / reception</b>,{' '}
                <b>optom / optom</b>, <b>ot / ot</b>
              </>
            ) : (
              'Ask the admin if you need an account or a password reset.'
            )}
          </div>
        </form>

        <div className="login-credit">
          <u>created by</u> <b>ai</b>
          <i>4</i>
          <u>work</u>
        </div>
      </div>
    </div>
  );
}
