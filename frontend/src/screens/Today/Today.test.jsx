import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { billing, mockStore } from '../../mocks/adapters';
import { dateStr } from '../../mocks/data';
import Today from './Today';

beforeEach(() => {
  mockStore.reset();
});

describe('Today summary', () => {
  it('shows patients, time per stage, money by mode, medicines and receipts — live bills included', async () => {
    window.print = vi.fn();
    // Chirag (id 8) pays ₹750 by card in the demo
    await billing.pay(8, 'card');
    renderShell({ route: '/today', child: <Today /> });

    const tiles = await screen.findByTestId('today-tiles');
    expect(within(tiles).getByText('Patients seen')).toBeInTheDocument();
    expect(within(tiles).getByText('Money collected')).toBeInTheDocument();
    // demo: six earlier patients (₹5,895) + Chirag's ₹750
    expect(tiles).toHaveTextContent('₹6,645');
    expect(tiles).toHaveTextContent('7 bills paid');

    const bars = screen.getByTestId('stage-bars');
    expect(within(bars).getByTestId('stage-bar-pretest')).toHaveTextContent('13 min');
    expect(within(bars).getByTestId('stage-bar-dilate')).toHaveTextContent('2 waiting now');
    expect(within(bars).queryByTestId('stage-bar-done')).toBeNull();
    await userEvent.hover(within(bars).getByTestId('stage-bar-doctor'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'With Doctor: 11 min on average over 6 patients'
    );

    const modes = screen.getByTestId('collections');
    expect(within(modes).getByText('Card').closest('tr')).toHaveTextContent('₹1,610');

    const receipts = screen.getByTestId('receipts');
    const row = within(receipts).getByText('Chirag Mehta').closest('tr');
    expect(row).toHaveTextContent((await billing.get(8)).receiptNo);
    await userEvent.click(within(row).getByRole('button', { name: /Print receipt .* again/ }));
    expect(await screen.findByTestId('receipt-print')).toHaveTextContent('Chirag Mehta');
    await waitFor(() => expect(window.print).toHaveBeenCalled());

    expect(screen.getByTestId('medicines-sold')).toHaveTextContent('Moxifloxacin 0.5% eye drops');
  });

  it('counts a part payment on the day it came in and lists money still owed with balances', async () => {
    // Chirag (id 8, ₹750) pays ₹500 in cash now; Bharat Oza still owes ₹60 from yesterday (demo)
    await billing.receive(8, { amount: 500, mode: 'cash' });
    renderShell({ route: '/today', child: <Today /> });
    const tiles = await screen.findByTestId('today-tiles');
    expect(tiles).toHaveTextContent('₹6,395'); // ₹5,895 earlier + ₹500
    const owed = screen.getByTestId('unpaid');
    expect(owed).toHaveTextContent('Money still owed');
    const chirag = within(owed).getByText('Chirag Mehta').closest('li');
    expect(chirag).toHaveTextContent('₹250');
    const bharat = within(owed).getByText('Bharat Oza').closest('li');
    expect(bharat).toHaveTextContent('₹60');
    expect(bharat).toHaveTextContent('from');
    expect(within(bharat).getByRole('link', { name: 'Bharat Oza' })).toHaveAttribute('href', '/patients/5');
    const receipts = screen.getByTestId('receipts');
    expect(within(receipts).getByText('Chirag Mehta').closest('tr')).toHaveTextContent('₹250 still owed');
  });

  it('looks at an earlier day from the strip', async () => {
    renderShell({ route: '/today', child: <Today /> });
    await screen.findByTestId('today-tiles');
    const yesterday = dateStr(-1);
    await userEvent.click(document.querySelector(`[data-date="${yesterday}"]`));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Summary for'));
    const sunday = new Date(yesterday + 'T00:00:00').getDay() === 0;
    if (sunday) expect(await screen.findByText('No bills paid on this day.')).toBeInTheDocument();
    else expect(await screen.findByTestId('receipts')).toBeInTheDocument();
  });
});
