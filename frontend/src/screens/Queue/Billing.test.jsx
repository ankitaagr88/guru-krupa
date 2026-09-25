import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN } from '../../test/utils';
import { billing, mockStore, prescriptions, visits } from '../../mocks/adapters';
import Queue from './Queue';

/* Billing like a till (lane B): one-tap charges, "Bought here" puts the medicine on the bill,
   amounts can be changed, paying gives a receipt that prints. Chirag Mehta (id 8) is at
   billing in the demo data: his visit fee (New patient, ₹500 after a discount — it follows the
   visit type) + Pre-test charges ₹250 (a typed line, day-book column TEST). */
function renderBilling() {
  return render(
    <MemoryRouter initialEntries={['/queue/billing?patient=8']}>
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
const billSection = () => drawer().querySelector('#billingSection');

beforeEach(() => {
  mockStore.reset();
});

describe('Billing panel', () => {
  it('adds a standard charge with one tap and lets reception change an amount', async () => {
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const chip = await within(drawer()).findByRole('button', { name: 'OT follow-up ₹350' });
    await userEvent.click(chip);
    await waitFor(() => expect(billSection()).toHaveTextContent('₹1,100'));
    let bill = await billing.get(8);
    const line = bill.items.find((i) => i.label === 'OT follow-up');
    expect(line).toMatchObject({ kind: 'charge', standardChargeId: 4, amount: 350 });
    // already on the bill -> the chip is spent
    await waitFor(() =>
      expect(within(drawer()).getByRole('button', { name: 'OT follow-up ₹350' })).toBeDisabled()
    );

    // a discount on the consultation
    const amt = within(billSection()).getByLabelText('Amount for New patient');
    fireEvent.change(amt, { target: { value: '400' } });
    fireEvent.blur(amt);
    await waitFor(() => expect(billSection()).toHaveTextContent('₹1,000'));
    bill = await billing.get(8);
    expect(bill.items.find((i) => i.label === 'New patient').amount).toBe(400);
  });

  it('"Bought here" puts the priced medicine on the bill; Undo takes it off', async () => {
    await prescriptions.save(8, [
      { name: 'Moxifloxacin 0.5% eye drops', dosage: '1 drop both eyes', qtyGiven: 2 },
    ]);
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const panel = await within(drawer()).findByTestId('dispense-panel');
    expect(within(panel).getByText('₹85')).toBeInTheDocument(); // price per pack shown
    await userEvent.click(within(panel).getByRole('button', { name: 'Bought here' }));
    await waitFor(() => expect(billSection()).toHaveTextContent('Moxifloxacin 0.5% eye drops × 2'));
    await waitFor(() => expect(billSection()).toHaveTextContent('₹920')); // 750 + 2 × 85
    const med = (await billing.get(8)).items.find((i) => i.kind === 'medicine');
    expect(med).toMatchObject({ qty: 2, amount: 170, prescriptionLineId: 1 });

    await userEvent.click(within(panel).getByRole('button', { name: /Undo bought here/ }));
    await waitFor(() => expect(billSection()).not.toHaveTextContent('Moxifloxacin'));
    expect((await billing.get(8)).total).toBe(750);
  });

  it('a medicine with no price goes on at ₹0 and asks reception to type it', async () => {
    await prescriptions.save(8, [{ name: 'Latanoprost 0.005% eye drops', dosage: 'at night', qtyGiven: 1 }]);
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const panel = await within(drawer()).findByTestId('dispense-panel');
    expect(within(panel).getByText('price not set')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Bought here' }));
    const note = await within(billSection()).findByTestId('price-not-set');
    expect(note).toHaveTextContent(/Admin › Medicines/);
    const amt = within(billSection()).getByLabelText('Amount for Latanoprost 0.005% eye drops × 1');
    fireEvent.change(amt, { target: { value: '320' } });
    fireEvent.blur(amt);
    await waitFor(() => expect(within(billSection()).queryByTestId('price-not-set')).toBeNull());
    expect((await billing.get(8)).total).toBe(1070);
  });

  it('paying gives a receipt number and "Print receipt" prints the receipt', async () => {
    window.print = vi.fn();
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await waitFor(() => expect(billSection()).toHaveTextContent('₹750'));
    await userEvent.click(within(billSection()).getByRole('button', { name: 'Cash' }));
    const paid = await within(billSection()).findByTestId('bill-paid');
    const receiptNo = (await billing.get(8)).receiptNo;
    expect(receiptNo).toMatch(/^GK-\d{4}-\d{5}$/);
    expect(paid).toHaveTextContent(receiptNo);

    await userEvent.click(within(paid).getByRole('button', { name: 'Print receipt' }));
    const sheet = await screen.findByTestId('receipt-print');
    expect(sheet).toHaveTextContent(receiptNo);
    expect(sheet).toHaveTextContent('Chirag Mehta');
    expect(sheet).toHaveTextContent('#003');
    expect(sheet).toHaveTextContent('Received with thanks');
    expect(sheet).toHaveTextContent('Cash');
    expect(sheet).toHaveTextContent('₹750');
    expect(sheet.querySelector('img.receipt-logo')).not.toBeNull();
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('receipt-print')).toBeNull());

    // undo the payment (entered by mistake): owing again, the receipt number stays with the bill
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(within(billSection()).getByRole('button', { name: 'Undo the ₹750 Cash payment' }));
    await waitFor(() => expect(within(billSection()).queryByTestId('bill-paid')).toBeNull());
    const bill = await billing.get(8);
    expect(bill).toMatchObject({ balance: 750, paid: false, receiptNo, payments: [] });
    confirm.mockRestore();
  });

  it('"Receive payment" takes part now and the rest later, each in its own mode', async () => {
    window.print = vi.fn();
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await waitFor(() => expect(billSection()).toHaveTextContent('₹750'));
    const box = within(billSection()).getByTestId('receive-payment');
    const amt = within(box).getByLabelText('Amount received');
    expect(amt).toHaveValue('750'); // starts at the balance
    await userEvent.clear(amt);
    await userEvent.type(amt, '800');
    await userEvent.click(within(box).getByRole('button', { name: 'Cash' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent('more than the ₹750');
    await userEvent.clear(amt);
    await userEvent.type(amt, '500');
    await userEvent.click(within(box).getByRole('button', { name: 'Cash' }));

    const due = await within(billSection()).findByTestId('bill-balance');
    expect(due).toHaveTextContent('₹250');
    const part = within(billSection()).getByTestId('bill-part-paid');
    expect(part).toHaveTextContent('Part paid');
    let bill = await billing.get(8);
    expect(bill).toMatchObject({ paidAmount: 500, balance: 250, status: 'part_paid', paid: false });
    expect(bill.receiptNo).toMatch(/^GK-/);

    // the rest by UPI: the amount box now starts at ₹250
    await waitFor(() =>
      expect(within(within(billSection()).getByTestId('receive-payment')).getByLabelText('Amount received')).toHaveValue('250')
    );
    await userEvent.click(within(within(billSection()).getByTestId('receive-payment')).getByRole('button', { name: 'UPI' }));
    const paid = await within(billSection()).findByTestId('bill-paid');
    expect(paid).toHaveTextContent('Paid · Cash + UPI');
    bill = await billing.get(8);
    expect(bill.payments.map((p) => [p.amount, p.mode])).toEqual([
      [500, 'cash'],
      [250, 'upi'],
    ]);
    expect(bill.receiptNo).toBe((await billing.get(8)).receiptNo);

    // the printed receipt lists both payments and the balance due
    await userEvent.click(within(paid).getByRole('button', { name: 'Print receipt' }));
    const rows = await screen.findByTestId('receipt-payments');
    expect(rows).toHaveTextContent('Cash');
    expect(rows).toHaveTextContent('UPI');
    expect(rows).toHaveTextContent('Balance due');
  });

  it('Glasses (₹0 in Admin) asks for the amount; a typed line picks its day-book column', async () => {
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await userEvent.click(await within(billSection()).findByRole('button', { name: /^Glasses/ }));
    const price = within(billSection()).getByLabelText('Amount for Glasses');
    await userEvent.type(price, '1200');
    await userEvent.click(
      within(screen.getByRole('form', { name: 'Glasses: type the amount' })).getByRole('button', { name: 'Add' })
    );
    await waitFor(() => expect(billSection()).toHaveTextContent('₹1,950'));
    let bill = await billing.get(8);
    expect(bill.items.find((i) => i.label === 'Glasses')).toMatchObject({ amount: 1200, accountHeadKey: 'glasses' });

    await userEvent.type(within(billSection()).getByPlaceholderText(/Item — e.g./), 'Frame repair');
    await userEvent.type(within(billSection()).getByPlaceholderText('₹'), '100');
    const pick = within(billSection()).getByLabelText('Day book column for the new item');
    await waitFor(() => expect(pick).toHaveValue('other')); // Admin's default for typed lines
    await userEvent.selectOptions(pick, 'glasses');
    await userEvent.click(within(billSection()).getAllByRole('button', { name: 'Add' }).at(-1));
    await waitFor(async () =>
      expect((await billing.get(8)).items.find((i) => i.label === 'Frame repair')?.accountHeadKey).toBe('glasses')
    );
    bill = await billing.get(8);
    expect(bill.total).toBe(2050);
  });

  it('a ₹0 bill closes with "No charge"', async () => {
    await billing.save(8, { items: [] });
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const zero = await within(billSection()).findByTestId('bill-zero');
    await userEvent.click(within(zero).getByRole('button', { name: 'No charge' }));
    expect(await within(billSection()).findByTestId('bill-paid')).toHaveTextContent('No charge');
    expect(await billing.get(8)).toMatchObject({ status: 'no_charge', paid: true, receiptNo: null });
  });

  it('a returning patient who still owes from an earlier visit: "₹60 still owed" and collect it', async () => {
    await visits.move(5, 'billing'); // Bharat Oza owes ₹60 from yesterday in the demo
    render(
      <MemoryRouter initialEntries={['/queue/billing?patient=5']}>
        <AppProviders initialUser={ADMIN}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/queue/:stage" element={<Queue />} />
            </Route>
          </Routes>
        </AppProviders>
      </MemoryRouter>
    );
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const notice = await within(drawer()).findByTestId('owed-notice');
    expect(notice).toHaveTextContent(/₹60 still owed from/);
    await userEvent.click(within(notice).getByRole('button', { name: 'Receive payment' }));
    await userEvent.click(within(notice).getByRole('button', { name: 'UPI' }));
    await waitFor(() => expect(within(drawer()).queryByTestId('owed-notice')).toBeNull());
    // only today's own bill is left to pay (the drawer's bill); the old ₹60 is settled
    expect((await billing.owing(5)).map((o) => o.visitId)).not.toContain(9001);
    expect((await billing.get(9001)).payments.map((p) => [p.amount, p.mode])).toContainEqual([60, 'upi']);
  });

  it('"Also collect old balance" takes both in one go, one payment per bill', async () => {
    await visits.move(5, 'billing'); // Bharat Oza: follow-up ₹350 today, ₹60 still owed from yesterday
    render(
      <MemoryRouter initialEntries={['/queue/billing?patient=5']}>
        <AppProviders initialUser={ADMIN}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/queue/:stage" element={<Queue />} />
            </Route>
          </Routes>
        </AppProviders>
      </MemoryRouter>
    );
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const box = await within(billSection()).findByTestId('receive-payment');
    await waitFor(() => expect(within(box).getByLabelText('Amount received')).toHaveValue('350'));
    await userEvent.click(await within(box).findByRole('checkbox', { name: 'Also collect old balance ₹60' }));
    expect(within(box).getByLabelText('Amount received')).toHaveValue('410');
    await userEvent.click(within(box).getByRole('button', { name: 'UPI' }));
    await waitFor(() => expect(within(billSection()).getByTestId('bill-paid')).toHaveTextContent('Paid · UPI'));
    expect((await billing.get(9001)).payments.map((p) => [p.amount, p.mode])).toContainEqual([60, 'upi']);
    expect(await billing.get(5)).toMatchObject({ paid: true, paidAmount: 350 });
    expect(await billing.owing(5)).toEqual([]);
    await waitFor(() => expect(within(drawer()).queryByTestId('owed-notice')).toBeNull());
  });
});

describe('Billing: one control for the visit fee', () => {
  it('the visit-type and emergency charges are not offered as chips; chips read plainly', async () => {
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const fees = await within(billSection()).findByRole('group', { name: 'Visit fees' });
    expect(within(fees).getByRole('button', { name: 'OT follow-up ₹350' })).toBeInTheDocument();
    ['Consultation / new file', 'Follow-up', 'New case', 'Emergency'].forEach((label) =>
      expect(within(fees).queryByRole('button', { name: new RegExp(`^${label} ₹`) })).toBeNull()
    );
    expect(within(billSection()).getByRole('button', { name: 'Perimetry ₹2,500 one eye · ₹4,000 both' })).toBeInTheDocument();
    expect(within(billSection()).getByRole('button', { name: 'Glasses — enter price' })).toBeInTheDocument();
  });

  it('the fee line follows the visit type; a free follow-up leaves ₹0 and "No charge"', async () => {
    await billing.save(8, { items: (await billing.get(8)).items.filter((i) => i.kind === 'charge') }); // just the fee
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await waitFor(() => expect(billSection()).toHaveTextContent('New patient'));
    // the fee line has no day-book picker (it goes under OPD); the column is shown by name on typed lines
    const feeLine = within(billSection()).getAllByTestId('bill-line')[0];
    expect(within(feeLine).queryByRole('combobox')).toBeNull();
    expect((await billing.get(8)).items[0]).toMatchObject({ label: 'New patient', accountHeadKey: 'opd' });

    const panel = within(drawer()).getByTestId('visit-kind-panel');
    await userEvent.click(within(panel).getByRole('radio', { name: /^New case/ }));
    await waitFor(async () => expect((await billing.get(8)).items).toMatchObject([{ label: 'New case', amount: 500 }]));
    expect(within(panel).getByRole('radio', { name: /Follow-up · free/ })).not.toHaveTextContent(/free\s*free/);
    await userEvent.click(within(panel).getByRole('radio', { name: /Follow-up · free/ }));
    const zero = await within(billSection()).findByTestId('bill-zero');
    expect((await billing.get(8)).total).toBe(0);
    await userEvent.click(within(zero).getByRole('button', { name: 'No charge' }));
    expect(await within(billSection()).findByTestId('bill-paid')).toHaveTextContent('No charge');
  });

  it('once money is received, a visit-type change keeps the fee line and says so', async () => {
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const box = await within(billSection()).findByTestId('receive-payment');
    await userEvent.clear(within(box).getByLabelText('Amount received'));
    await userEvent.type(within(box).getByLabelText('Amount received'), '100');
    await userEvent.click(within(box).getByRole('button', { name: 'Cash' }));
    await within(billSection()).findByTestId('bill-part-paid');
    await userEvent.click(within(within(drawer()).getByTestId('visit-kind-panel')).getByRole('radio', { name: /^New case/ }));
    expect(await within(billSection()).findByTestId('bill-fee-kept')).toHaveTextContent(
      'Now New case — already paid, so the fee stays New patient ₹500'
    );
  });
});

describe('Billing: completing the visit from the drawer footer', () => {
  it('while money is owed, "Receive payment" leads; completing asks first and can keep it owed', async () => {
    renderBilling();
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const foot = () => within(drawer().querySelector('.drawer-foot'));
    await waitFor(() => expect(foot().getByTestId('foot-summary')).toHaveTextContent('Balance ₹750'));
    expect(foot().getByRole('button', { name: 'Receive payment' })).toHaveClass('btn-primary');
    expect(foot().getByRole('button', { name: 'Complete visit' })).not.toHaveClass('btn-primary');

    await userEvent.click(foot().getByRole('button', { name: 'Complete visit' }));
    expect(foot().getByTestId('complete-confirm')).toHaveTextContent(
      '₹750 not received — complete anyway and keep it as owed?'
    );
    await userEvent.click(foot().getByRole('button', { name: 'Cancel' }));
    expect((await visits.get(8)).stage).toBe('billing');

    await userEvent.click(foot().getByRole('button', { name: 'Complete visit' }));
    await userEvent.click(foot().getByRole('button', { name: 'Complete, keep as owed' }));
    await waitFor(async () => expect((await visits.get(8)).stage).toBe('done'));
    expect((await billing.owing(8)).map((o) => o.balance)).toEqual([750]);
  });
});
