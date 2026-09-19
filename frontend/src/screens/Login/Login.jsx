import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { USE_MOCKS } from '../../api';
import { EyeMark } from '../../components/Icons';
import { HOSPITAL_NAME, DOCTOR_NAME } from '../../nav';

/* Real login form (F1 owner A4 may restyle). Calls auth.login, stores the
   session via AuthContext and redirects to where the user was going (or /queue). */
export default function Login() {
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="login-page">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="login-brand">
          <div className="rail-mark">
            <EyeMark />
          </div>
          <div>
            <h1>{HOSPITAL_NAME}</h1>
            <p>{DOCTOR_NAME} · Staff sign in</p>
          </div>
        </div>

        <label htmlFor="username">Username</label>
        <input
          id="username"
          className={`fake-input${error ? ' error' : ''}`}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          disabled={busy}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          className={`fake-input${error ? ' error' : ''}`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
        />

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
              Mock mode — try <b>admin / admin</b>, <b>doctor / doctor</b>, <b>reception / reception</b>,{' '}
              <b>optom / optom</b>, <b>ot / ot</b>
            </>
          ) : (
            'Ask the admin if you need an account or a password reset.'
          )}
        </div>
      </form>
    </div>
  );
}
