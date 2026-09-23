import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN, renderShell } from '../../test/utils';
import { billing, fees, mockStore } from '../../mocks/adapters';
import { dateStr } from '../../mocks/data';
import Queue from './Queue';
import Admin from '../Admin/Admin';
import Today from '../Today/Today';

/* Visit kinds & fees (lane E2): the queue tag, changing the kind in the drawer ("Different
   problem"), the bill pre-filled with the suggested fee, the one / both eyes chooser, the Admin
   rules form and the Today counts — all in demo mode. */
function renderQueue(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders initialUser={ADMIN}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/queue/:stage" element={<Queue />} />
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}
const drawer = () => document.querySelector('#drawer');
const board = () => document.querySelector('#board');
const billSection = () => drawer().querySelector('#billingSection');
const row = (id) => mockStore.state.patients.find((p) => p.id === id);

beforeEach(() => {
  mockStore.reset();
});

describe('Visit kinds & fees', () => {
  it('tags each queue row with its visit kind and emergency', async () => {
    row(2).lastVisitDate = dateStr(-3); // Kiran: back after 3 days -> free follow-up
    row(1).emergency = true;
    row(1).visitKindKey = 'new';
    renderQueue('/queue/reg');
    await waitFor(() => expect(board()).toHaveTextContent('Rasilaben Patel'));
    const rasila = screen.getByTestId('queue-row-1');
    expect(rasila).toHaveTextContent('New patient');
    expect(rasila).toHaveTextContent('Emergency');
    expect(screen.getByTestId('queue-row-2')).toHaveTextContent('Follow-up · free');
  });

  it('reception sees why and changes the kind; "Different problem" charges a new case', async () => {
    row(2).lastVisitDate = dateStr(-12); // follow-up, ₹350
    renderQueue('/queue/reg?patient=2');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const now = await within(drawer()).findByTestId('visit-kind-now');
    expect(now).toHaveTextContent('Follow-up');
    expect(now).toHaveTextContent('₹350');
    expect(now).toHaveTextContent('Last visit 12 days ago');

    await userEvent.click(await within(drawer()).findByTestId('different-problem'));
    await waitFor(() => expect(row(2).visitKindKey).toBe('new_case'));
    await waitFor(() => expect(within(drawer()).getByTestId('visit-kind-now')).toHaveTextContent('New case'));
    expect(within(drawer()).queryByTestId('different-problem')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('queue-row-2')).toHaveTextContent('New case'));

    await userEvent.click(within(drawer()).getByRole('radio', { name: /Follow-up · free/ }));
    await waitFor(() => expect(row(2).visitKindKey).toBe('free_follow_up'));
    await userEvent.click(within(drawer()).getByRole('checkbox', { name: /Emergency fee/ }));
    await waitFor(() => expect(row(2).emergency).toBe(true));
  });

  it('the doctor can mark "Different problem" too', async () => {
    row(5).lastVisitDate = dateStr(-40); // Bharat Oza, with the doctor in the demo
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    expect(within(drawer()).queryByRole('radiogroup', { name: 'Visit type' })).toBeNull();
    await userEvent.click(await within(drawer()).findByTestId('different-problem'));
    await waitFor(() => expect(row(5).visitKindKey).toBe('new_case'));
  });

  it('a new bill starts with the suggested fee; changing the kind swaps it; free follow-up says no charge', async () => {
    Object.assign(row(2), { stage: 'billing', lastVisitDate: dateStr(-20) });
    renderQueue('/queue/billing?patient=2');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await waitFor(() => expect(billSection()).toHaveTextContent('Follow-up'));
    const line = within(billSection()).getAllByTestId('bill-line')[0];
    expect(line).toHaveTextContent('Suggested');
    expect((await billing.get(2)).items).toMatchObject([
      { label: 'Follow-up', amount: 350, suggested: true },
    ]);

    await userEvent.click(within(drawer()).getByTestId('different-problem'));
    await waitFor(async () =>
      expect((await billing.get(2)).items).toMatchObject([{ label: 'New case', amount: 500 }])
    );
    await waitFor(() => expect(billSection()).toHaveTextContent('₹500'));

    await userEvent.click(within(drawer()).getByRole('radio', { name: /Follow-up · free/ }));
    expect(await within(billSection()).findByTestId('bill-fee-note')).toHaveTextContent(
      'Follow-up within 6 days — no charge'
    );
    expect((await billing.get(2)).items).toEqual([]);
  });

  it('a test priced per eye asks one eye or both eyes', async () => {
    Object.assign(row(2), { stage: 'billing', lastVisitDate: dateStr(-2) }); // free follow-up: empty bill
    renderQueue('/queue/billing?patient=2');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const tests = await within(drawer()).findByRole('group', { name: 'Tests' });
    await userEvent.click(within(tests).getByRole('button', { name: /Perimetry/ }));
    const chooser = within(drawer()).getByRole('group', { name: /Perimetry: one eye or both eyes/ });
    expect(chooser).toHaveTextContent('₹2,500');
    await userEvent.click(within(chooser).getByRole('button', { name: /Both eyes/ }));
    await waitFor(() => expect(billSection()).toHaveTextContent('Perimetry — both eyes'));
    expect((await billing.get(2)).items).toMatchObject([
      { label: 'Perimetry — both eyes', amount: 4000, eyes: 'both', standardChargeId: 6 },
    ]);
    // headings group the chips
    expect(within(drawer()).getByRole('group', { name: 'Visit fees' })).toBeInTheDocument();
    expect(within(drawer()).getByRole('group', { name: 'Packages' })).toBeInTheDocument();
  });
});

describe('Admin › Visit types & fee rules', () => {
  const section = () => screen.getByRole('heading', { name: 'Visit types & fee rules' }).closest('section');

  // The Admin page is long; give it room on a busy machine.
  it('lists the visit types with their charge and saves the rules', { timeout: 20000 }, async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Visit types & fee rules' });
    await waitFor(() => expect(within(section()).getByTestId('visit-kind-follow_up')).toBeInTheDocument());
    expect(within(section()).getByLabelText('Charge for Follow-up')).toHaveDisplayValue('Follow-up · ₹350');
    expect(within(section()).getByLabelText('Charge for After surgery')).toHaveDisplayValue(
      'Free — no charge'
    );
    expect(within(section()).getByText('To confirm with Dr Anu')).toBeInTheDocument();

    const days = within(section()).getByLabelText('Free follow-up days');
    expect(days).toHaveValue('6');
    await userEvent.clear(days);
    await userEvent.type(days, '7');
    const from = within(section()).getByLabelText('Emergency from');
    await userEvent.clear(from);
    await userEvent.type(from, '21:00');
    await userEvent.click(within(section()).getByRole('button', { name: 'Save fee rules' }));
    await waitFor(async () => expect((await fees.rules()).freeFollowUpDays).toBe(7));
    expect((await fees.rules()).emergencyFrom).toBe('21:00');

    // rules that don't add up are refused with a plain message
    const newCase = within(section()).getByLabelText('New case after days');
    await userEvent.clear(newCase);
    await userEvent.type(newCase, '5');
    await userEvent.click(within(section()).getByRole('button', { name: 'Save fee rules' }));
    expect(await screen.findByText(/must be more days than the free follow-up/)).toBeInTheDocument();
    expect((await fees.rules()).newCaseAfterDays).toBe(182);
  });

  it('adds a visit type with a charge', { timeout: 20000 }, async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Visit types & fee rules' });
    await userEvent.type(within(section()).getByLabelText('New visit type'), 'OT follow-up');
    await userEvent.selectOptions(within(section()).getByLabelText('New visit type charge'), '4');
    await userEvent.click(within(section()).getByRole('button', { name: '+ Add a visit type' }));
    await waitFor(async () =>
      expect((await fees.kinds()).find((k) => k.label === 'OT follow-up')).toMatchObject({
        key: 'ot_follow_up',
        chargeAmount: 350,
      })
    );
  });
});

describe('Today › visits by type', () => {
  it('counts new patients, follow-ups, new cases and emergencies', async () => {
    Object.assign(row(1), { visitKindKey: 'new', emergency: true });
    renderShell({ route: '/today', child: <Today /> });
    const counts = await screen.findByTestId('visit-kind-counts');
    expect(within(counts).getByTestId('kind-count-new')).toHaveTextContent('New patient');
    expect(within(counts).getByTestId('kind-count-_emergency')).toHaveTextContent('1 Emergencies');
    expect(within(counts).getByTestId('kind-count-new_case')).toBeInTheDocument();
  });
});
