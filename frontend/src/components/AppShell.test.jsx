import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell, ADMIN, RECEPTION } from '../test/utils';

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

  it('shows the full hospital name in the desktop topbar', () => {
    renderShell({ user: ADMIN });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Guru Krupa Eye Hospital & Laser Center'
    );
  });

  it('mobile mode: hides the rail, shows bottom nav and the slide-out menu with stage counts', async () => {
    sessionStorage.setItem('gk_device', 'mobile');
    renderShell({ user: ADMIN, route: '/queue' });
    await waitFor(() => expect(document.body).toHaveClass('mobile-mode'));
    expect(document.querySelector('.sidenav')).toBeNull();
    expect(document.querySelector('.mobile-bottom-nav')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Guru Krupa');
    await userEvent.click(document.querySelector('.hamburger-btn'));
    expect(document.querySelector('#mobileNavDrawer')).toHaveClass('show');
    await waitFor(() =>
      expect(document.querySelector('#mobileNavStageList')).toHaveTextContent('Registration')
    );
    await waitFor(() => expect(document.querySelector('#mobileNavStageList')).toHaveTextContent('2'));
  });

  it('opens the search modal with Ctrl+K and finds a patient', async () => {
    renderShell({ user: ADMIN });
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByText('Find a patient')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'oza');
    await waitFor(() => expect(screen.getByText('Bharat Oza')).toBeInTheDocument());
  });
});
