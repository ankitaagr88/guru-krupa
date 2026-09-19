import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../App';
import AppShell from '../components/AppShell';

export const ADMIN = { id: 1, name: 'Dr. Anu Juneja Pathak', username: 'admin', role: 'admin', active: true };
export const RECEPTION = {
  id: 4,
  name: 'Reception desk',
  username: 'reception',
  role: 'reception',
  active: true,
};

/** Render `ui` inside providers + a MemoryRouter at `route`. `user` seeds AuthContext (null = signed out). */
export function renderWithProviders(ui, { route = '/', user = ADMIN } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders initialUser={user}>{ui}</AppProviders>
    </MemoryRouter>
  );
}

/** Render the shell with a trivial child screen at `route`. */
export function renderShell({ route = '/queue', user = ADMIN, child = <div>screen</div> } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders initialUser={user}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={child} />
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}
