import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderShell, ADMIN, RECEPTION } from '../test/utils';
import { AppProviders } from '../App';
import AppShell from './AppShell';
import Queue from '../screens/Queue';
import { mockStore, visits } from '../mocks/adapters';

describe('AppShell', () => {
  it('renders every rail item for an admin, including Admin', () => {
    renderShell({ user: ADMIN });
    expect(screen.getByText('screen')).toBeInTheDocument();
    for (const key of ['queue', 'appointments', 'ot', 'machines', 'mrs', 'inventory', 'admin']) {
      expect(document.querySelector(`#nav-${key}`)).not.toBeNull();
    }
  });

  it('hides Admin (and MRs) from reception staff', () => {
    renderShell({ user: RECEPTION });
    expect(document.querySelector('#nav-admin')).toBeNull();
    expect(document.querySelector('#nav-mrs')).not.toBeNull();
    expect(document.querySelector('#nav-queue')).not.toBeNull();
    expect(document.querySelector('#nav-inventory')).not.toBeNull();
  });

  it('hides Admin and MRs from an optometrist', () => {
    renderShell({ user: { id: 3, name: 'Optom', username: 'optom', role: 'optometrist' } });
    expect(document.querySelector('#nav-admin')).toBeNull();
    expect(document.querySelector('#nav-mrs')).toBeNull();
    expect(document.querySelector('#nav-machines')).not.toBeNull();
  });

  it('marks the active rail item from the route', () => {
    renderShell({ user: ADMIN, route: '/inventory' });
    expect(document.querySelector('#nav-inventory')).toHaveClass('active');
    expect(document.querySelector('#nav-queue')).not.toHaveClass('active');
  });

  it('desktop topbar: the screen name is the heading, the full hospital name sits small above it', () => {
    renderShell({ user: ADMIN, route: '/appointments' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Appointments');
    expect(screen.getByTestId('topbar-hospital')).toHaveTextContent('Guru Krupa Eye Hospital & Laser Center');
  });

  it('Appointments comes before Queue in the side menu; Day book has its own icon', () => {
    renderShell({ user: ADMIN });
    const side = [...document.querySelectorAll('.sidenav .sidenav-item')].map((a) => a.id);
    expect(side.slice(0, 2)).toEqual(['nav-appointments', 'nav-queue']);
    const dayIcon = document.querySelector('#nav-daybook svg').innerHTML;
    expect(dayIcon).not.toBe(document.querySelector('#nav-today svg').innerHTML);
  });

  it('phone: bottom tabs and the overflow sheet list Appointments before Queue', async () => {
    sessionStorage.setItem('gk_device', 'mobile');
    renderShell({ user: ADMIN });
    await waitFor(() => expect(document.body).toHaveClass('mobile-mode'));
    const tabs = [...document.querySelectorAll('.mobile-bottom-nav .bottomnav-item')].map((a) => a.textContent);
    expect(tabs[0]).toBe('Appts');
    expect(tabs[1]).toMatch(/^Queue/);
    const sheet = [...document.querySelectorAll('#mobileNavDrawer .mobile-nav-admin')].map((a) => a.textContent);
    expect(sheet.slice(0, 2)).toEqual(['Appointments', 'Queue']);
  });

  it('mobile mode: hides the rail, shows bottom nav and the slide-out menu with stage counts', async () => {
    sessionStorage.setItem('gk_device', 'mobile');
    renderShell({ user: ADMIN, route: '/queue' });
    await waitFor(() => expect(document.body).toHaveClass('mobile-mode'));
    expect(document.querySelector('.sidenav')).toBeNull();
    expect(document.querySelector('.mobile-bottom-nav')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Queue');
    expect(screen.getByTestId('topbar-hospital')).toHaveTextContent('Guru Krupa');
    await userEvent.click(document.querySelector('.hamburger-btn'));
    expect(document.querySelector('#mobileNavDrawer')).toHaveClass('show');
    await waitFor(() =>
      expect(document.querySelector('#mobileNavStageList')).toHaveTextContent('Registration')
    );
    await waitFor(() => expect(document.querySelector('#mobileNavStageList')).toHaveTextContent('2'));
  });

  it('desktop: the top-bar search box is always there; "/" focuses it and typing lists matches', async () => {
    renderShell({ user: ADMIN, route: '/inventory' });
    const box = screen.getByPlaceholderText('Search patients by name, phone or token');
    expect(screen.queryByRole('button', { name: 'Search patients' })).toBeNull(); // no magnifier button
    await userEvent.keyboard('/');
    expect(box).toHaveFocus();
    await userEvent.type(box, 'oza');
    await waitFor(() => expect(screen.getByText('Bharat Oza')).toBeInTheDocument());
    expect(screen.queryByText('Find a patient')).toBeNull(); // no modal on desktop
    await userEvent.click(screen.getByText('Bharat Oza'));
    await waitFor(() => expect(screen.queryByText('Bharat Oza')).toBeNull()); // list closes after the jump
    expect(box).toHaveValue('');
  });

  it('desktop: Ctrl+K focuses the box too; Escape clears it', async () => {
    renderShell({ user: ADMIN });
    await userEvent.keyboard('{Control>}k{/Control}');
    const box = screen.getByRole('searchbox', { name: 'Search patients' });
    expect(box).toHaveFocus();
    await userEvent.type(box, 'patel');
    await waitFor(() => expect(screen.getByText('Rasilaben Patel')).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(screen.queryByText('Rasilaben Patel')).toBeNull();
  });

  it('phone: a compact magnifier opens the search modal', async () => {
    sessionStorage.setItem('gk_device', 'mobile');
    renderShell({ user: ADMIN });
    await waitFor(() => expect(document.body).toHaveClass('mobile-mode'));
    expect(screen.queryByPlaceholderText('Search patients by name, phone or token')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Search patients' }));
    expect(screen.getByText('Find a patient')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'oza');
    await waitFor(() => expect(screen.getByText('Bharat Oza')).toBeInTheDocument());
  });

  it('search: someone not in today\'s queue gets "Add to today" (with a reason) — queued, drawer opens', async () => {
    mockStore.reset();
    render(
      <MemoryRouter initialEntries={['/inventory']}>
        <AppProviders initialUser={ADMIN}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/queue/:stage" element={<Queue />} />
              <Route path="*" element={<div>screen</div>} />
            </Route>
          </Routes>
        </AppProviders>
      </MemoryRouter>
    );
    const box = screen.getByPlaceholderText('Search patients by name, phone or token');
    await userEvent.type(box, 'nirmala');
    const row = await screen.findByTestId('search-result-901');
    expect(row).toHaveTextContent('Patient record');
    // someone in the queue has no such button
    await userEvent.clear(box);
    await userEvent.type(box, 'oza');
    await screen.findByText('Bharat Oza');
    expect(screen.queryByTestId('search-add-5')).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, 'nirmala');
    await userEvent.click(await screen.findByTestId('search-add-901'));
    await userEvent.type(await screen.findByLabelText('Reason for visit (optional)'), 'Sugar check, blurred vision');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Nirmala Joshi added to the queue')).toBeInTheDocument();
    const v = (await visits.today()).find((x) => x.id === 901);
    expect(v).toMatchObject({ stage: 'reg', note: 'Sugar check, blurred vision' });
    await waitFor(() => expect(document.querySelector('#drawer')).toHaveClass('show'));
  });
});
