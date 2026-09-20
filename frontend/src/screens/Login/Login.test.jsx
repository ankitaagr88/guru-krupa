import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import Login from './Login';

function renderLogin(route = '/login') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders initialUser={null}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/queue" element={<div>queue screen</div>} />
          <Route path="/inventory" element={<div>inventory screen</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

describe('Login', () => {
  it('shows the hospital branding and validates empty fields', async () => {
    renderLogin();
    expect(screen.getByText('Guru Krupa Eye Hospital & Laser Center')).toBeInTheDocument();
    expect(screen.getByText('Staff sign in')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your username and password');
  });

  it('rejects a wrong password and signs in with a right one (mock mode), honouring ?next=', async () => {
    renderLogin('/login?next=/inventory');
    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password');

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'admin');
    await userEvent.click(screen.getByLabelText('Show password'));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('inventory screen')).toBeInTheDocument();
    expect(localStorage.getItem('gk_token')).toBe('mock-token-admin');
  });
});
