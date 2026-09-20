import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN } from '../../test/utils';
import { mockStore, patients, visits } from '../../mocks/adapters';
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

const drawer = () => document.querySelector('#drawer');
const board = () => document.querySelector('#board');

beforeEach(() => {
  mockStore.reset();
});

describe('Queue board', () => {
  it('renders the rows for the current stage and moves a patient to the next stage', async () => {
    renderQueue('/queue/reg');
    await waitFor(() => expect(board()).toHaveTextContent('Rasilaben Patel'));
    expect(board()).toHaveTextContent('Kiran Vaghela');
    expect(board()).not.toHaveTextContent('Mahesh Desai');
    expect(screen.getByTestId('stage-pill-reg')).toHaveTextContent('2');
    expect(screen.getByTestId('stage-pill-pretest')).toHaveTextContent('2');

    await userEvent.click(screen.getByTestId('queue-row-1'));
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    expect(within(drawer()).getByText('Rasilaben Patel')).toBeInTheDocument();
    await userEvent.click(within(drawer()).getByRole('button', { name: /Send for pre-testing/ }));

    await waitFor(() => expect(board()).not.toHaveTextContent('Rasilaben Patel'));
    await waitFor(() => expect(drawer()).not.toHaveClass('show'));
    expect(screen.getByTestId('stage-pill-pretest')).toHaveTextContent('3');
    expect((await visits.today({ stage: 'pretest' })).map((p) => p.name)).toContain('Rasilaben Patel');
  });

  it('new-patient modal creates the patient, registers the visit and shows the token', async () => {
    renderQueue('/queue/pretest');
    await waitFor(() => expect(board()).toHaveTextContent('Mahesh Desai'));
    await userEvent.click(screen.getByRole('button', { name: '+ New patient' }));
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Test Person');
    await userEvent.type(screen.getByPlaceholderText('Phone number'), '90000 00000');
    await userEvent.click(screen.getByTestId('np-cond-Diabetes'));
    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    await waitFor(() => expect(screen.getByText('Token #016')).toBeInTheDocument());
    expect(screen.getByText('Test Person added to the queue')).toBeInTheDocument();
    // navigated to the registration stage with the new row
    await waitFor(() => expect(board()).toHaveTextContent('Test Person'));
    expect(board()).toHaveTextContent('#016');
    const created = (await patients.list({ q: 'Test Person' }))[0];
    expect(created.existingConditions).toEqual(['Diabetes']);
    expect(created.stage).toBe('reg');
  });

  it('drawer edits persist through the API', async () => {
    renderQueue('/queue/reg');
    await waitFor(() => expect(board()).toHaveTextContent('Kiran Vaghela'));
    await userEvent.click(screen.getByTestId('queue-row-2'));
    await waitFor(() => expect(drawer()).toHaveClass('show'));

    const address = within(drawer()).getByPlaceholderText('Address');
    await userEvent.clear(address);
    await userEvent.type(address, 'Pal, Surat');
    await userEvent.click(within(drawer()).getByRole('button', { name: 'F' }));
    await userEvent.click(within(drawer()).getByRole('switch'));
    await userEvent.type(
      within(drawer()).getByPlaceholderText(/type what the patient tells you/),
      'LASIK, Mumbai'
    );

    await waitFor(async () => {
      const p = await patients.get(2);
      expect(p.address).toBe('Pal, Surat');
      expect(p.sex).toBe('F');
      expect(p.elsewhere).toBe(true);
      expect(p.elsewhereNote).toBe('LASIK, Mumbai');
    });
    // meta line reflects the edit
    expect(drawer().querySelector('.drawer-head .meta')).toHaveTextContent('34F');
  });

  it('opens the drawer from ?patient= (search deep-link)', async () => {
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    expect(within(drawer()).getByText('Bharat Oza')).toBeInTheDocument();
    expect(drawer()).toHaveTextContent('Last visit:');
    expect(drawer()).toHaveTextContent('Existing conditions: Diabetes, Hypertension');
  });
});

describe('Dilation', () => {
  it('starts the protocol from the doctor stage, ticks a step and shows the timer on the row', async () => {
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await userEvent.click(within(drawer()).getByRole('button', { name: /Start dilation drops/ }));
    await waitFor(() => expect(drawer()).not.toHaveClass('show'));
    await waitFor(async () => expect((await visits.get(5)).stage).toBe('dilate'));

    // open him on the dilate board
    await userEvent.click(screen.getByTestId('stage-pill-dilate'));
    await waitFor(() => expect(board()).toHaveTextContent('Bharat Oza'));
    expect(screen.getByTestId('queue-row-5')).toHaveTextContent('Step 1/2 · give Tropicamide 0.8%');
    await userEvent.click(screen.getByTestId('queue-row-5'));
    await waitFor(() => expect(drawer()).toHaveClass('show'));

    const step0 = within(drawer()).getByTestId('dstep-0');
    expect(step0).toHaveClass('tickable');
    await userEvent.click(within(step0).getByRole('checkbox'));
    await waitFor(() => expect(within(drawer()).getByTestId('dstep-0')).toHaveTextContent('given, waiting'));
    expect(within(drawer()).getByTestId('dstep-0').querySelector('.dstep-tag.timer')).toHaveTextContent(
      /0[45]:\d\d/
    );
    expect(within(drawer()).getByTestId('dstep-1')).toHaveTextContent('up next');
    await waitFor(() => expect(screen.getByTestId('queue-row-5')).toHaveTextContent('Dilating 0'));
    const run = await visits.dilation(5);
    expect(run.steps[0].given).toBe(true);
    expect(run.steps[0].startedAt).toBeTruthy();
  });

  it('auto-advances an overdue step and toasts (timer recomputed from startedAt)', async () => {
    // Seeded Ilaben Chauhan: step 2 (20 min) started 23 min ago → overdue on load.
    renderQueue('/queue/dilate');
    await waitFor(() => expect(board()).toHaveTextContent('Ilaben Chauhan'));
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((t) => t.textContent.includes('Ilaben Chauhan'))).toBe(true)
    );
    expect(screen.getByText(/Dilation wait is up/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('queue-row-7')).toHaveTextContent('All drops given'));
    const run = await visits.dilation(7);
    expect(run.currentIndex).toBe(2);
    expect(run.steps[1].done).toBe(true);
    // Sangita (11 min into a 20 min step) is still counting down
    expect(screen.getByTestId('queue-row-6')).toHaveTextContent(/Dilating 0[89]:\d\d · Step 2\/2/);
  });

  it('asks for confirmation before sending a patient back mid-protocol', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderQueue('/queue/dilate?patient=6');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await userEvent.click(within(drawer()).getByRole('button', { name: /Back to doctor now/ }));
    expect(confirm).toHaveBeenCalled();
    expect((await visits.get(6)).stage).toBe('dilate');
    confirm.mockReturnValue(true);
    await userEvent.click(within(drawer()).getByRole('button', { name: /Back to doctor now/ }));
    await waitFor(async () => expect((await visits.get(6)).stage).toBe('doctor'));
    confirm.mockRestore();
  });
});

describe('Billing', () => {
  it('adds items, picks a payment mode and completes the visit', async () => {
    renderQueue('/queue/billing?patient=8');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await waitFor(() => expect(drawer()).toHaveTextContent('₹750'));
    await userEvent.type(within(drawer()).getByPlaceholderText(/Item — e.g./), 'Dilation drops');
    await userEvent.type(within(drawer()).getByPlaceholderText('₹'), '150');
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(drawer()).toHaveTextContent('₹900'));
    await userEvent.click(within(drawer()).getByRole('button', { name: 'UPI' }));
    await waitFor(() => expect(drawer()).toHaveTextContent('paid via upi'));
    const bill = await visits.bill(8);
    expect(bill.items).toHaveLength(3);
    expect(bill.paymentMode).toBe('upi');
    expect(bill.paid).toBe(true);

    await userEvent.click(within(drawer()).getByRole('button', { name: /Mark visit complete/ }));
    await waitFor(async () => expect((await visits.get(8)).stage).toBe('done'));
    await waitFor(() => expect(drawer()).not.toHaveClass('show'));
  });
});

describe('Prescription from the drawer (F14)', () => {
  it('doctor stage shows the saved lines with a type chip and the button opens the PrescriptionModal', async () => {
    window.print = vi.fn();
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const btn = await within(drawer()).findByRole('button', { name: /prescription/i });
    expect(drawer()).toHaveTextContent('Timolol 0.5% eye drops');
    await waitFor(() => expect(within(drawer()).getAllByText('Drops')[0]).toHaveClass('med-type-chip'));
    await userEvent.click(btn);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Print language')).toBeInTheDocument();
    expect((await within(dialog).findAllByTestId('med-row')).length).toBe(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
