import axios from 'axios';

export const TOKEN_KEY = 'gk_token';
export const USER_KEY = 'gk_user';

export const session = {
  getToken: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  getUser: () => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

const client = axios.create({
  baseURL: '/api',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = session.getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401 → drop the session and send the user to /login (unless we're already there
// or this was the login call itself, whose 401 the form handles).
client.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';
    if (status === 401 && !url.includes('/auth/login')) {
      session.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}`);
      }
    }
    return Promise.reject(error);
  }
);

/** Pull a human-readable message out of an axios/fetch error. */
export function errorMessage(err, fallback = 'Something went wrong') {
  if (!err) return fallback;
  const d = err.response?.data;
  if (typeof d === 'string') return d;
  if (d?.detail) return typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail);
  if (d?.message) return d.message;
  if (err.code === 'ERR_NETWORK') return 'Cannot reach the server';
  return err.message || fallback;
}

export default client;
