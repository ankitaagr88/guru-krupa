import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderShell } from '../../test/utils';
import { mockStore } from '../../mocks/adapters';
import Patient from './Patient';
import Queue from '../Queue';

describe('Patient screen', () => {
  beforeEach(() => mockStore.reset());

  it('shows details, totals, the visit with its prescription, and surgeries', async () => {
    // Bharat Oza (id 5): seeded Glaucoma prescription and a monthly follow-up history
    renderShell({
      route: '/patients/5',
      child: (
        <Routes>
          <Route path="/patients/:id" element={<Patient />} />
        </Routes>
      ),
    });
    expect(await screen.findByTestId('patient-screen')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Bharat Oza' })).toBeInTheDocument();
    expect(screen.getByText('Previous system id')).toBeInTheDocument();
    const visits = await screen.findAllByTestId('patient-visit');
    expect(visits.length).toBeGreaterThanOrEqual(2); // today + the 18 Aug follow-up
    expect(within(visits[0]).getByText('Timolol 0.5% eye drops')).toBeInTheDocument();
    expect(within(visits[0]).getAllByText(/Glaucoma/).length).toBeGreaterThan(0);
    expect(within(visits[0]).getByTestId('patient-open-rx')).toBeInTheDocument();
    expect(screen.getByText("Open today's visit")).toHaveAttribute('href', expect.stringContaining('?patient=5'));
  });

  it('a patient name on the queue links to the record', async () => {
    renderShell({ route: '/queue/reg', child: <Queue /> });
    const link = (await screen.findAllByTestId('patient-link'))[0];
    expect(link).toHaveAttribute('href', expect.stringMatching(/^\/patients\/\d+$/));
    await userEvent.click(link);
    // navigated away from the queue: the drawer did not open
    expect(document.querySelector('#drawer.show')).toBeNull();
  });
});
