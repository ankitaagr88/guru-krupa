import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

// The real clinic app (not demo mode): the same demo data underneath, but USE_MOCKS is off,
// so every demo-only control must be gone.
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), USE_MOCKS: false }));
vi.mock('idb', () => import('../test/fakeIdb'));

import { renderShell } from '../test/utils';
import { mockStore } from '../mocks/adapters';
import Machines from '../screens/Machines/Machines';

describe('Outside demo mode', () => {
  beforeEach(() => {
    globalThis.indexedDB = {};
    mockStore.reset();
  });

  it('the Machines screen has no "Demo: no connection" button (phone)', async () => {
    sessionStorage.setItem('gk_device', 'mobile');
    renderShell({ route: '/machines', child: <Machines /> });
    await screen.findByText('Which machine are you using?'); // machines load first
    expect(screen.queryByTestId('offline-toggle')).toBeNull();
    expect(screen.queryByText(/Demo:/)).toBeNull();
  });

  it('the top bar does not say "demo data" (desktop)', async () => {
    renderShell({ route: '/machines', child: <Machines /> });
    await screen.findByText('Which machine are you using?');
    expect(screen.queryByTestId('offline-toggle')).toBeNull();
    expect(document.querySelector('#topSub')).not.toHaveTextContent('demo data');
  });
});
