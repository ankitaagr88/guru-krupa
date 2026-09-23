import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN } from '../../test/utils';
import { mockStore, patients, reception, visits } from '../../mocks/adapters';
import { localIso } from '../../lib/format';
import Queue from './Queue';

function renderQueue(route = '/queue/reg') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders initialUser={ADMIN}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/queue" element={<Queue />} />
            <Route path="/queue/:stage" element={<Queue />} />
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

const board = () => document.querySelector('#board');
const modal = () => document.querySelector('#modalOverlay');

async function openForm() {
  renderQueue('/queue/reg');
  await waitFor(() => expect(board()).toHaveTextContent('Rasilaben Patel'));
  await userEvent.click(screen.getByRole('button', { name: '+ New patient' }));
}

function yearsAgo(n) {
  const d = new Date();
  d.setDate(1);
  d.setFullYear(d.getFullYear() - n);
  d.setMonth(d.getMonth() - 1);
  return localIso(d);
}

beforeEach(() => {
  mockStore.reset();
});

describe('New patient: already registered with this number', () => {
  it('"Use this patient" registers today\'s visit for the existing record instead of a new one', async () => {
    // Pooja Trivedi (id 9) finished earlier, so she is not in the queue right now.
    await openForm();
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Pooja Trivedi');
    await userEvent.type(screen.getByPlaceholderText('Phone number'), '+91 98240-89012');

    const panel = await screen.findByTestId('same-phone');
    expect(panel).toHaveTextContent('Already registered with this number');
    const row = within(panel).getByTestId('same-phone-9');
    expect(row).toHaveTextContent('Pooja Trivedi');
    expect(row).toHaveTextContent('52 y · F');

    const before = (await patients.list()).length;
    await userEvent.click(within(row).getByRole('button', { name: 'Use this patient' }));

    await waitFor(() => expect(modal()).toBeNull());
    expect(await screen.findByText('Pooja Trivedi added to the queue')).toBeInTheDocument();
    expect((await patients.list()).length).toBe(before); // no duplicate record
    expect((await visits.today({ stage: 'reg' })).map((p) => p.name)).toContain('Pooja Trivedi');
    await waitFor(() => expect(board()).toHaveTextContent('Pooja Trivedi'));
  });

  it('someone already in today\'s queue is offered "Open today\'s visit"', async () => {
    await openForm();
    await userEvent.type(screen.getByPlaceholderText('Phone number'), '9825012345');
    const row = await screen.findByTestId('same-phone-1');
    expect(row).toHaveTextContent('Rasilaben Patel');
    expect(row).toHaveTextContent("in today's queue · #014");
    await userEvent.click(within(row).getByRole('button', { name: "Open today's visit" }));
    await waitFor(() => expect(modal()).toBeNull());
    await waitFor(() => expect(document.querySelector('#drawer')).toHaveClass('show'));
  });

  it('"No — new patient" hides the prompt and the form creates a new record on the same number', async () => {
    await openForm();
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Rasila Sister');
    await userEvent.type(screen.getByPlaceholderText('Phone number'), '98250 12345');
    const panel = await screen.findByTestId('same-phone');
    await userEvent.click(within(panel).getByRole('button', { name: 'No — new patient' }));
    expect(screen.queryByTestId('same-phone')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText('Rasila Sister added to the queue')).toBeInTheDocument();
    const same = await reception.samePhone('98250 12345');
    expect(same.map((p) => p.name).sort()).toEqual(['Rasila Sister', 'Rasilaben Patel']);
  });

  it('no prompt for a number nobody has', async () => {
    await openForm();
    await userEvent.type(screen.getByPlaceholderText('Phone number'), '90000 00000');
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId('same-phone')).toBeNull();
  });
});

describe('New patient: date of birth', () => {
  it('typing a DOB shows the worked-out age and saves the DOB', async () => {
    await openForm();
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Dob Person');
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: yearsAgo(30) } });
    expect(screen.getByTestId('np-dob-age')).toHaveTextContent('Age 30 y from the date of birth');
    const age = screen.getByLabelText('Age (if DOB not known)');
    expect(age).toBeDisabled();
    expect(age).toHaveValue('30');

    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText('Dob Person added to the queue')).toBeInTheDocument();
    const p = (await patients.list({ q: 'Dob Person' }))[0];
    expect(p.dob).toBe(yearsAgo(30));
    expect(p.age).toBe(30);
  });

  it('the age box is the fallback when the DOB is not known', async () => {
    await openForm();
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Age Person');
    await userEvent.type(screen.getByLabelText('Age (if DOB not known)'), '47');
    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText('Age Person added to the queue')).toBeInTheDocument();
    const p = (await patients.list({ q: 'Age Person' }))[0];
    expect(p.dob).toBeNull();
    expect(p.age).toBe(47);
  });

  it('a DOB in the future is refused in plain words', async () => {
    await openForm();
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Future Person');
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: localIso(next) } });
    expect(screen.getByRole('alert')).toHaveTextContent('Date of birth cannot be in the future.');
    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(modal()).not.toBeNull();
    expect(await patients.list({ q: 'Future Person' })).toEqual([]);
  });
});
