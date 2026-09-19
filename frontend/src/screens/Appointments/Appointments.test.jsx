import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN } from '../../test/utils';
import { mockStore, appointments, visits } from '../../mocks/adapters';
import { dateStr } from '../../mocks/data';
import Appointments from './Appointments';
import Queue from '../Queue';

function renderAppts(route = '/appointments') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders initialUser={ADMIN}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/queue/:stage" element={<Queue />} />
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

const list = () => document.querySelector('#apptList');

beforeEach(() => {
  mockStore.reset();
});

describe('Appointments', () => {
  it('shows the day strip with counts and the list for the selected day', async () => {
    renderAppts();
    await waitFor(() => expect(list()).toHaveTextContent('Priya Mehta'));
    expect(list()).toHaveTextContent('Suresh Bhatt');
    expect(list()).not.toHaveTextContent('Kishor Panchal');
    const today = document.querySelector(`.date-pill[data-date="${dateStr(0)}"]`);
    expect(today.querySelector('.dcount')).toHaveTextContent('3');
    await userEvent.click(document.querySelector(`.date-pill[data-date="${dateStr(1)}"]`));
    await waitFor(() => expect(list()).toHaveTextContent('Kishor Panchal'));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Tomorrow/);
  });

  it('adds an appointment for the selected day with a channel', async () => {
    renderAppts();
    await waitFor(() => expect(list()).toHaveTextContent('Priya Mehta'));
    await userEvent.click(screen.getByRole('button', { name: '+ New appointment' }));
    await userEvent.type(screen.getByPlaceholderText('Patient name'), 'Nita Joshi');
    await userEvent.type(screen.getByPlaceholderText('Phone number'), '91111 22222');
    await userEvent.click(screen.getByRole('button', { name: 'Call' }));
    await userEvent.click(screen.getByRole('button', { name: 'Book appointment' }));
    await waitFor(() => expect(list()).toHaveTextContent('Nita Joshi'));
    const created = (await appointments.list({ date: dateStr(0) })).find((a) => a.name === 'Nita Joshi');
    expect(created.channel).toBe('call');
    expect(created.checkedIn).toBe(false);
  });

  it('edits and deletes an appointment', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAppts();
    await waitFor(() => expect(list()).toHaveTextContent('Suresh Bhatt'));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Suresh Bhatt' }));
    const name = screen.getByPlaceholderText('Patient name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Suresh B. Bhatt');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(list()).toHaveTextContent('Suresh B. Bhatt'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete Suresh B. Bhatt' }));
    await waitFor(() => expect(list()).not.toHaveTextContent('Suresh B. Bhatt'));
    expect((await appointments.list({ date: dateStr(0) })).some((a) => a.id === 2)).toBe(false);
    window.confirm.mockRestore();
  });

  it('check-in registers a queue visit and jumps to the registration drawer', async () => {
    renderAppts();
    await waitFor(() => expect(list()).toHaveTextContent('Priya Mehta'));
    const row = screen.getByTestId('appt-row-1');
    await userEvent.click(within(row).getByRole('button', { name: 'Check in' }));

    // navigated to /queue/reg?patient=<id> with the drawer open
    await waitFor(() => expect(document.querySelector('#board')).toHaveTextContent('Priya Mehta'));
    await waitFor(() => expect(document.querySelector('#drawer')).toHaveClass('show'));
    expect(within(document.querySelector('#drawer')).getByText('Priya Mehta')).toBeInTheDocument();
    const reg = await visits.today({ stage: 'reg' });
    const p = reg.find((x) => x.name === 'Priya Mehta');
    expect(p.token).toBe('#016');
    expect(p.note).toMatch(/WhatsApp/);
    const a = (await appointments.list({ date: dateStr(0) })).find((x) => x.id === 1);
    expect(a.checkedIn).toBe(true);
    expect(a.patientId).toBe(p.id);
  });
});
