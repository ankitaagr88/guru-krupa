import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN } from '../../test/utils';
import { mockStore, visits } from '../../mocks/adapters';
import Queue from '../Queue/Queue';

/* The staff New patient form (queue "+ New patient") and the registration drawer: visible labels,
   Enter saves, the cursor starts in Full name, and a "Reason for visit" that becomes the visit's note. */

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

beforeEach(() => mockStore.reset());

describe('New patient form', () => {
  it('has a label on every field, starts in Full name, and Enter adds to the queue with the reason for visit', async () => {
    renderQueue();
    await waitFor(() => expect(document.querySelector('#board')).toHaveTextContent('Rasilaben Patel'));
    await userEvent.click(screen.getByRole('button', { name: '+ New patient' }));
    const form = await screen.findByRole('dialog', { name: 'New patient' });
    for (const label of [
      'Full name',
      'Mobile number',
      'Address / area',
      'Occupation',
      'Screen time (hrs/day)',
      'Reason for visit',
      'Other condition',
      'How did they hear about us?',
    ])
      expect(within(form).getByLabelText(label)).toBeInTheDocument();
    expect(within(form).getByLabelText('Full name')).toHaveFocus();

    await userEvent.type(within(form).getByLabelText('Full name'), 'Reason Person');
    await userEvent.type(within(form).getByLabelText('Reason for visit'), 'Headache while reading{Enter}');
    expect(await screen.findByText('Reason Person added to the queue')).toBeInTheDocument();
    const v = (await visits.today({ stage: 'reg' })).find((x) => x.name === 'Reason Person');
    expect(v.note).toBe('Headache while reading');
    expect(v.token).toMatch(/^#\d{3}$/);
  });

  it('the registration drawer shows "Reason for visit" with a label and saves it on the visit', async () => {
    renderQueue('/queue/reg?patient=2'); // Kiran Vaghela — "Blurred vision, 3 days"
    const reason = await screen.findByLabelText('Reason for visit');
    expect(reason).toHaveValue('Blurred vision, 3 days');
    expect(screen.getByLabelText('Full name')).toHaveValue('Kiran Vaghela');
    await userEvent.clear(reason);
    await userEvent.type(reason, 'Blurred vision, 5 days');
    await waitFor(async () => expect((await visits.get(2)).note).toBe('Blurred vision, 5 days'), { timeout: 3000 });
  });
});
