import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderShell } from '../../test/utils';
import { mockStore, patients } from '../../mocks/adapters';
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

  it('shows age · sex and the DOB, and "Edit details" saves the person\'s details', async () => {
    renderShell({
      route: '/patients/2',
      child: (
        <Routes>
          <Route path="/patients/:id" element={<Patient />} />
        </Routes>
      ),
    });
    expect(await screen.findByTestId('patient-age-sex')).toHaveTextContent('34 y · M');
    expect(screen.getByText('Not known')).toBeInTheDocument(); // no DOB yet

    await userEvent.click(screen.getByTestId('patient-edit'));
    const dialog = document.querySelector('#editPatientModal');
    const name = within(dialog).getByLabelText('Full name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Kiran R Vaghela');
    fireEvent.change(within(dialog).getByLabelText('Date of birth'), { target: { value: '1990-03-12' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save details' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Kiran R Vaghela' })).toBeInTheDocument();
    expect(document.querySelector('#editPatientModal')).toBeNull();
    expect(screen.getAllByText(/12 Mar 1990/).length).toBeGreaterThan(0);
    const p = await patients.get(2);
    expect(p.dob).toBe('1990-03-12');
    const today = new Date();
    expect(p.age).toBe(today.getFullYear() - 1990 - (today.getMonth() < 2 || (today.getMonth() === 2 && today.getDate() < 12) ? 1 : 0));
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
