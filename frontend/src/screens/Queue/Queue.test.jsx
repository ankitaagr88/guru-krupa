import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN } from '../../test/utils';
import { billing, mockStore, patients, visits } from '../../mocks/adapters';
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
    await userEvent.type(screen.getByPlaceholderText('10-digit mobile number'), '90000 00000');
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

  it('the dilation toast stays, sends the patient to the doctor, and the Dilating tab counts who is ready', async () => {
    renderQueue('/queue/dilate'); // Ilaben Chauhan's last drop is overdue on load
    await waitFor(() => expect(board()).toHaveTextContent('Ilaben Chauhan'));
    const toast = await waitFor(() => {
      const t = screen.getAllByTestId('toast').find((x) => x.textContent.includes('Ilaben Chauhan'));
      expect(t).toBeTruthy();
      return t;
    });
    await waitFor(() => expect(screen.getByTestId('dilate-ready')).toHaveTextContent('1 ready'));
    expect(within(toast).getByRole('button', { name: 'Open' })).toBeInTheDocument();
    await userEvent.click(within(toast).getByRole('button', { name: 'Send to doctor' }));
    await waitFor(async () => expect((await visits.get(7)).stage).toBe('doctor'));
    await waitFor(() => expect(screen.queryByTestId('dilate-ready')).toBeNull());
  });

  it('the dilation drawer puts the drops first and the prescription second', async () => {
    renderQueue('/queue/dilate?patient=6');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const body = drawer().querySelector('.drawer-body');
    const drops = body.querySelector('#dilationSection');
    const rx = body.querySelector('#rxSection');
    expect(drops.compareDocumentPosition(rx) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(rx).getByRole('button', { name: /Write prescription/ })).toHaveClass('secondary');
  });
});

describe('Queue rows and the drawer', () => {
  it('clicking the name opens the drawer (not the record); the record is linked from the drawer header', async () => {
    renderQueue('/queue/reg');
    await waitFor(() => expect(board()).toHaveTextContent('Rasilaben Patel'));
    await userEvent.click(within(screen.getByTestId('queue-row-1')).getByRole('button', { name: 'Rasilaben Patel' }));
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    expect(within(drawer().querySelector('.drawer-head')).getByTestId('drawer-record-link')).toHaveAttribute(
      'href',
      '/patients/1'
    );
    // a phone card opens the drawer too, and shows no date of birth
    expect(screen.getByTestId('patient-card-1')).not.toHaveTextContent('DOB');
  });

  it('the move buttons sit in the drawer footer; after registration the details fold away', async () => {
    renderQueue('/queue/pretest?patient=4');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const foot = drawer().querySelector('.drawer-foot');
    expect(within(foot).getByRole('button', { name: 'Send in to doctor' })).toBeInTheDocument();
    const details = within(drawer()).getByTestId('patient-details');
    expect(details.open).toBe(false);
    expect(within(drawer()).getByTestId('capture-reading-link')).toHaveAttribute('href', '/machines?visit=4');
    await userEvent.click(within(foot).getByRole('button', { name: 'Send in to doctor' }));
    await waitFor(async () => expect((await visits.get(4)).stage).toBe('doctor'));
  });

  it('a finished visit shows its time, not a clock that keeps running', async () => {
    renderQueue('/queue/done');
    await waitFor(() => expect(board()).toHaveTextContent('Pooja Trivedi'));
    expect(screen.getByTestId('queue-row-9')).toHaveTextContent(/Total|Done at/);
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
    const foot = within(drawer().querySelector('.drawer-foot'));
    await waitFor(() => expect(foot.getByTestId('foot-summary')).toHaveTextContent('Paid · UPI'));
    const bill = await billing.get(8);
    expect(bill.items).toHaveLength(3);
    expect(bill.paymentMode).toBe('upi');
    expect(bill.paid).toBe(true);

    // paid: completing needs no question
    await userEvent.click(foot.getByRole('button', { name: 'Complete visit' }));
    await waitFor(async () => expect((await visits.get(8)).stage).toBe('done'));
    await waitFor(() => expect(drawer()).not.toHaveClass('show'));
  });
});

describe('Prescription from the drawer (F14)', () => {
  it('doctor stage shows the saved lines by name and the button opens the PrescriptionModal', async () => {
    window.print = vi.fn();
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const btn = await within(drawer()).findByRole('button', { name: /prescription/i });
    expect(drawer()).toHaveTextContent('Timolol 0.5% eye drops');
    expect(drawer().querySelector('.med-type-chip')).toBeNull();
    await userEvent.click(btn);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Print language')).toBeInTheDocument();
    expect((await within(dialog).findAllByTestId('med-row')).length).toBe(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Billing: bought-here confirmation', () => {
  it('lists the prescribed medicines; "Bought here" deducts stock, Undo restores it', async () => {
    const api = await import('../../api');
    // Chirag Mehta (id 8) is at billing in the demo data; give him a prescription first
    await api.prescriptions.save(8, [
      { name: 'Latanoprost 0.005% eye drops', dosage: 'at night', qtyGiven: 1 },
      { name: 'Unknown compounded gel', dosage: 'x', qtyGiven: 0 },
    ]);
    const before = (await api.inventory.list()).find((i) => i.name === 'Latanoprost 0.005% eye drops').stock;
    renderQueue('/queue/billing?patient=8');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const panel = await within(drawer()).findByTestId('dispense-panel');
    const rows = within(panel).getAllByTestId('dispense-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('Patient buys outside')).toBeInTheDocument();
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Bought here' }));
    await waitFor(() => expect(within(panel).getByText(/Bought 1/)).toBeInTheDocument());
    expect((await api.inventory.list()).find((i) => i.name === 'Latanoprost 0.005% eye drops').stock).toBe(before - 1);
    await userEvent.click(within(panel).getByRole('button', { name: /Undo bought here/ }));
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Bought here' })).toBeInTheDocument());
    expect((await api.inventory.list()).find((i) => i.name === 'Latanoprost 0.005% eye drops').stock).toBe(before);
  });
});
