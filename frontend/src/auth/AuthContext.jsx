import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { auth as authApi, session, USE_MOCKS, errorMessage } from '../api';

export const ROLES = ['admin', 'doctor', 'optometrist', 'reception', 'ot_staff'];
export const ROLE_LABELS = {
  admin: 'Admin',
  doctor: 'Doctor',
  optometrist: 'Optometrist',
  reception: 'Reception',
  ot_staff: 'OT staff',
};

const AuthContext = createContext(null);

export function AuthProvider({ children, initialUser }) {
  const [currentUser, setCurrentUser] = useState(initialUser ?? session.getUser());
  const [loading, setLoading] = useState(initialUser === undefined);

  // On load: restore from localStorage and validate against /auth/me.
  // In mock mode with no session, sign in as a fake admin so screens just work.
  useEffect(() => {
    if (initialUser !== undefined) return;
    let cancelled = false;
    (async () => {
      const token = session.getToken();
      if (!token) {
        if (USE_MOCKS) {
          const fake = {
            id: 1,
            name: 'Dr. Anu Juneja Pathak',
            username: 'admin',
            role: 'admin',
            active: true,
          };
          session.set('mock-token-admin', fake);
          if (!cancelled) setCurrentUser(fake);
        }
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const me = await authApi.me();
        session.set(token, me);
        if (!cancelled) setCurrentUser(me);
      } catch (err) {
        // 401 is handled by the axios interceptor (clears + redirects). For
        // network errors keep the cached user so the PWA still opens offline.
        if (err?.response?.status === 401) {
          session.clear();
          if (!cancelled) setCurrentUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialUser]);

  const login = useCallback(async (username, password) => {
    try {
      const res = await authApi.login({ username, password });
      session.set(res.access_token, res.user);
      setCurrentUser(res.user);
      return res.user;
    } catch (err) {
      const status = err?.response?.status;
      const msg = status === 401 ? 'Incorrect username or password' : errorMessage(err, 'Could not sign in');
      const e = new Error(msg);
      e.status = status;
      throw e;
    }
  }, []);

  const logout = useCallback(() => {
    session.clear();
    setCurrentUser(null);
  }, []);

  const value = useMemo(
    () => ({
      currentUser,
      role: currentUser?.role ?? null,
      isAuthenticated: !!currentUser,
      loading,
      login,
      logout,
      hasRole: (roles) => !!currentUser && (roles?.length ? roles.includes(currentUser.role) : true),
    }),
    [currentUser, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Redirects to /login (remembering where the user was) when signed out. */
export function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        Signing you in…
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

/** Allows only the given roles; others are bounced to `fallback` (default /queue). */
export function RequireRole({ roles = [], fallback = '/queue', children }) {
  const { currentUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!currentUser) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles.length && !roles.includes(currentUser.role)) return <Navigate to={fallback} replace />;
  return children;
}
