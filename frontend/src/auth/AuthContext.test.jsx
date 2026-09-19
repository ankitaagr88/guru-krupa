import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Force the real (axios) adapters and mock axios itself.
vi.mock('../api/index.js', async () => {
  const real = await import('../api/real.js');
  const clientMod = await import('../api/client.js');
  return {
    ...real,
    USE_MOCKS: false,
    client: clientMod.default,
    errorMessage: clientMod.errorMessage,
    session: clientMod.session,
    onDataChange: () => () => {},
  };
});
vi.mock('axios', () => {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { default: { create: () => instance }, __instance: instance };
});

import { AuthProvider, useAuth, RequireRole, RequireAuth } from './AuthContext';
import { session } from '../api/client';

const http = (await import('axios')).__instance;

function Probe() {
  const { currentUser, login, logout, loading } = useAuth();
  return (
    <div>
      <div data-testid="user">
        {loading ? 'loading' : currentUser ? `${currentUser.username}:${currentUser.role}` : 'none'}
      </div>
      <button
        onClick={() =>
          login('admin', 'secret').catch((e) => {
            document.title = e.message;
          })
        }
      >
        login
      </button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.title = '';
});

describe('AuthContext', () => {
  it('logs in via POST /auth/login, stores the session, and logs out', async () => {
    http.post.mockResolvedValueOnce({
      data: {
        access_token: 'tok123',
        token_type: 'bearer',
        user: { id: 1, name: 'A', username: 'admin', role: 'admin', active: true },
      },
    });
    render(
      <MemoryRouter>
        <AuthProvider initialUser={null}>
          <Probe />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(screen.getByTestId('user')).toHaveTextContent('none');

    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('admin:admin'));
    expect(http.post).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'secret' });
    expect(session.getToken()).toBe('tok123');
    expect(session.getUser().role).toBe('admin');

    await userEvent.click(screen.getByText('logout'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(session.getToken()).toBeNull();
  });

  it('surfaces a friendly message on 401', async () => {
    http.post.mockRejectedValueOnce({ response: { status: 401, data: { detail: 'bad' } } });
    render(
      <MemoryRouter>
        <AuthProvider initialUser={null}>
          <Probe />
        </AuthProvider>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(document.title).toBe('Incorrect username or password'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('restores a stored session and validates it with GET /auth/me', async () => {
    session.set('tok-restored', { id: 2, name: 'Doc', username: 'doctor', role: 'doctor', active: true });
    http.get.mockResolvedValueOnce({
      data: { id: 2, name: 'Doc', username: 'doctor', role: 'doctor', active: true },
    });
    render(
      <MemoryRouter>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('doctor:doctor'));
    expect(http.get).toHaveBeenCalledWith('/auth/me');
  });

  it('clears the session when /auth/me returns 401', async () => {
    session.set('stale', { id: 2, username: 'doctor', role: 'doctor' });
    http.get.mockRejectedValueOnce({ response: { status: 401 } });
    render(
      <MemoryRouter>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    expect(session.getToken()).toBeNull();
  });
});

describe('route guards', () => {
  const tree = (user) => (
    <MemoryRouter initialEntries={['/admin']}>
      <AuthProvider initialUser={user}>
        <Routes>
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/queue" element={<div>QUEUE PAGE</div>} />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <RequireRole roles={['admin']}>
                  <div>ADMIN PAGE</div>
                </RequireRole>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );

  it('RequireRole lets admins through', () => {
    render(tree({ id: 1, username: 'admin', role: 'admin' }));
    expect(screen.getByText('ADMIN PAGE')).toBeInTheDocument();
  });
  it('RequireRole redirects non-admins to /queue', () => {
    render(tree({ id: 4, username: 'reception', role: 'reception' }));
    expect(screen.getByText('QUEUE PAGE')).toBeInTheDocument();
  });
  it('RequireAuth redirects signed-out users to /login', () => {
    render(tree(null));
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
  });
});
