import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN } from '../../test/utils';
import { billing, mockStore, prescriptions } from '../../mocks/adapters';
import Queue from './Queue';

/* Billing like a till (lane B): one-tap charges, "Bought here" puts the medicine on the bill,
   amounts can be changed, paying gives a receipt that prints. Chirag Mehta (id 8) is at
   billing in the demo data with Consultation fee ₹500 + Pre-test charges ₹250. */
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
    const chip = await within(drawer()).findByRole('button', { name: 'Dilation ₹150' });
    await userEvent.click(chip);
    await waitFor(() => expect(billSection()).toHaveTextContent('₹900'));
    let bill = await billing.get(8);
    const line = bill.items.find((i) => i.label === 'Dilation');
    expect(line).toMatchObject({ kind: 'charge', standardChargeId: 4, amount: 150 });
    // already on the bill -> the chip is spent
    await waitFor(() =>
      expect(within(drawer()).getByRole('button', { name: 'Dilation ₹150' })).toBeDisabled()
    );

    // a discount on the consultation
    const amt = within(billSection()).getByLabelText('Amount for Consultation fee');
    fireEvent.change(amt, { target: { value: '400' } });
    fireEvent.blur(amt);
    await waitFor(() => expect(billSection()).toHaveTextContent('₹800'));
    bill = await billing.get(8);
    expect(bill.items.find((i) => i.label === 'Consultation fee').amount).toBe(400);
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

    // paying again with another mode keeps the number
    await userEvent.click(within(billSection()).getByRole('button', { name: 'UPI' }));
    await waitFor(async () => expect((await billing.get(8)).paymentMode).toBe('upi'));
    expect((await billing.get(8)).receiptNo).toBe(receiptNo);
  });
});
