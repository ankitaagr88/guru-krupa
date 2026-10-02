import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderShell, RECEPTION } from '../../test/utils';
import { billing, mockStore, patients, visits } from '../../mocks/adapters';
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
    // only what is known is listed: no empty "Previous system id: —" row
    expect(screen.queryByText('Previous system id')).toBeNull();
    expect(screen.getByText('Conditions')).toBeInTheDocument();
    const visits = await screen.findAllByTestId('patient-visit');
    expect(visits.length).toBeGreaterThanOrEqual(2); // today + the 18 Aug follow-up
    expect(within(visits[0]).getByText('Timolol 0.5% eye drops')).toBeInTheDocument();
    expect(within(visits[0]).getAllByText(/Glaucoma/).length).toBeGreaterThan(0);
    expect(within(visits[0]).getByTestId('patient-open-rx')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Open today's visit" })).toHaveAttribute(
      'href',
      expect.stringContaining('?patient=5')
    );
    // "insurance" shows as the admin's wording
    expect(screen.getByText('Insurance / TPA')).toBeInTheDocument();
  });

  it('is the hub: shortcuts for today\'s visit, machine reading, prescription, bill, money owed, appointment, surgery', async () => {
    renderShell({
      route: '/patients/5',
      child: (
        <Routes>
          <Route path="/patients/:id" element={<Patient />} />
        </Routes>
      ),
    });
    const bar = await screen.findByTestId('patient-shortcuts');
    expect(within(bar).getByRole('link', { name: 'Capture machine reading' })).toHaveAttribute('href', '/machines?visit=5');
    expect(within(bar).getByRole('link', { name: 'Book appointment' })).toHaveAttribute('href', '/appointments?patient=5');
    expect(within(bar).getByRole('link', { name: 'Schedule surgery' })).toHaveAttribute('href', '/ot?patient=5');
    expect(within(bar).getByRole('link', { name: "Today's bill" })).toHaveAttribute('href', expect.stringContaining('?patient=5'));
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'Receive payment' })).toBeInTheDocument());
    expect(within(bar).getByRole('button', { name: 'Family' })).toBeInTheDocument();
    // today's prescription opens from here (admin)
    await userEvent.click(within(bar).getByRole('button', { name: "Today's prescription" }));
    expect(await screen.findByText('Print language')).toBeInTheDocument();
  });

  it('reception sees no prescription shortcut; someone not in today\'s queue gets "Add to today" with a reason', async () => {
    renderShell({
      user: RECEPTION,
      route: '/patients/902', // Rakesh Parmar: a returning patient, not here today
      child: (
        <Routes>
          <Route path="/patients/:id" element={<Patient />} />
          <Route path="/queue/:stage" element={<Queue />} />
        </Routes>
      ),
    });
    const bar = await screen.findByTestId('patient-shortcuts');
    expect(within(bar).queryByRole('button', { name: /prescription/i })).toBeNull();
    expect(within(bar).queryByRole('link', { name: 'Capture machine reading' })).toBeNull();
    await userEvent.click(within(bar).getByRole('button', { name: "Add to today's queue" }));
    await userEvent.type(await screen.findByLabelText('Reason for visit (optional)'), 'Red eye since morning');
    await userEvent.click(screen.getByTestId('add-today-confirm'));
    expect(await screen.findByText('Rakesh Parmar added to the queue')).toBeInTheDocument();
    const v = (await visits.today()).find((x) => x.id === 902);
    expect(v.note).toBe('Red eye since morning');
    expect(v.token).toMatch(/^#\d{3}$/);
    await waitFor(() => expect(document.querySelector('#drawer')).toHaveClass('show'));
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
    expect(screen.queryByText(/DOB/)).toBeNull(); // no DOB yet: nothing shown

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

  it('shows money still owed from an earlier visit and receives it', async () => {
    // Bharat Oza (id 5) still owes ₹60 from yesterday in the demo
    renderShell({
      route: '/patients/5',
      child: (
        <Routes>
          <Route path="/patients/:id" element={<Patient />} />
        </Routes>
      ),
    });
    const card = await screen.findByTestId('owed-card');
    expect(card).toHaveTextContent('Money still owed · ₹60');
    expect(within(card).getByTestId('owed-row')).toHaveTextContent(/₹60 still owed from/);
    await userEvent.click(within(card).getByRole('button', { name: 'Receive payment' }));
    const amount = within(card).getByLabelText('Amount received');
    expect(amount).toHaveValue('60');
    await userEvent.clear(amount);
    await userEvent.type(amount, '40');
    await userEvent.click(within(card).getByRole('button', { name: 'Cash' }));
    await waitFor(() => expect(screen.getByTestId('owed-card')).toHaveTextContent('Money still owed · ₹20'));
    await userEvent.click(within(screen.getByTestId('owed-card')).getByRole('button', { name: 'Receive payment' }));
    await userEvent.click(within(screen.getByTestId('owed-card')).getByRole('button', { name: 'UPI' }));
    await waitFor(() => expect(screen.queryByTestId('owed-card')).toBeNull());
    expect((await billing.owing(5)).filter((o) => o.visitId === 9001)).toEqual([]);
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
