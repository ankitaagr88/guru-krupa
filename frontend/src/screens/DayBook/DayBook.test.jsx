import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { billing, daybook, mockStore } from '../../mocks/adapters';
import { dateStr } from '../../mocks/data';
import DayBook from './DayBook';

/* Day book (lane M): the daily cash sheet — rows, columns, totals — and the cash drawer. Demo:
   six patients seen earlier today, today's queue, Bharat Oza's ₹60 still owed from yesterday,
   yesterday's drawer opened at ₹4,040 with ₹3,000 taken out by MAAM. */
beforeEach(() => {
  mockStore.reset();
});

const num = (text) => Number(String(text).replace(/[^\d-]/g, ''));

describe('Day book', () => {
  it('shows one row per patient with the money under its column, totals, mode and what is left', async () => {
    // Chirag (id 8, Consultation 500 + Pre-test 250) pays 500 cash now; Bharat pays his old ₹60 by UPI
    await billing.receive(8, { amount: 500, mode: 'cash' });
    await billing.receive(9001, { amount: 60, mode: 'upi' });
    renderShell({ route: '/daybook', child: <DayBook /> });

    const table = await screen.findByTestId('daybook-table');
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers.slice(0, 5)).toEqual(['#', 'Name', 'Phone', 'Age/Sex', 'Area']);
    expect(headers.slice(5, 11)).toEqual(['OPD', 'MED', 'TEST', 'GLASSES', 'OT', 'OTHER']);
    expect(headers.slice(-3)).toEqual(['Total', 'Mode', 'Left']);

    const hetal = within(table).getByText('Hetal Joshi').closest('tr');
    expect(hetal).toHaveTextContent('20/F');
    expect(hetal).toHaveTextContent('Adajan');
    expect(hetal).toHaveTextContent('Cash');

    const chirag = within(table).getByRole('link', { name: 'Chirag Mehta' }).closest('tr');
    expect(chirag).toHaveTextContent('Rander, Surat');
    const cells = within(chirag).getAllByRole('cell').map((td) => td.textContent);
    expect(num(cells.at(-3))).toBe(750); // total
    expect(cells.at(-2)).toBe('Cash');
    expect(num(cells.at(-1))).toBe(250); // left
    // a visit with no bill yet still has its row; still in the clinic, so "in clinic" rather than a 0
    const rasila = within(table).getByRole('link', { name: 'Rasilaben Patel' }).closest('tr');
    expect(within(within(rasila).getAllByRole('cell').at(-3)).getByTestId('daybook-in-clinic')).toHaveTextContent(
      'in clinic'
    );
    // a finished visit is not "in clinic"
    const pooja = within(table).getByRole('link', { name: 'Pooja Trivedi' }).closest('tr');
    expect(within(pooja).queryByTestId('daybook-in-clinic')).toBeNull();
    // returning patients who haven't come in today have no row
    expect(within(table).queryByText('Nirmala Joshi')).toBeNull();

    const old = within(table).getByText(/old balance/).closest('tr');
    expect(old).toHaveTextContent('Bharat Oza');
    expect(old).toHaveTextContent('UPI');

    const totals = screen.getByTestId('daybook-totals');
    const book = await daybook.day(dateStr(0));
    expect(num(within(totals).getAllByRole('cell').at(-3).textContent)).toBe(book.totals.total);
    const modes = screen.getByTestId('daybook-modes');
    expect(within(modes).getByText('UPI').closest('tr')).toHaveTextContent('₹1,645'); // 1085 + 500 + 60
  });

  it('cash drawer: opening defaults to the previous closing; set it, take cash out, undo', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderShell({ route: '/daybook', child: <DayBook /> });
    const box = await screen.findByTestId('cash-box');
    const yesterday = await daybook.day(dateStr(-1));
    expect(yesterday.cash.openingCash).toBe(4040);
    expect(yesterday.cash.movements[0]).toMatchObject({ person: 'MAAM', amount: 3000, direction: 'out' });
    // today opens with yesterday's closing cash
    expect(num(within(box).getByTestId('cash-opening').textContent)).toBe(yesterday.cash.closingCash);
    expect(box).toHaveTextContent('carried forward');

    await userEvent.click(screen.getByRole('button', { name: 'Set opening cash' }));
    const opening = screen.getByLabelText('Opening cash');
    await userEvent.clear(opening);
    await userEvent.type(opening, '5000');
    await userEvent.click(within(screen.getByRole('form', { name: 'Set opening cash' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(num(screen.getByTestId('cash-opening').textContent)).toBe(5000));
    expect(screen.getByTestId('cash-box')).toHaveTextContent(/set by/);

    const cashIn = (await daybook.day(dateStr(0))).cash.cashReceived;
    await userEvent.click(screen.getByRole('button', { name: 'Cash taken out / put in' }));
    // the amount box has the cursor, and "Set opening cash" is still there
    expect(screen.getByLabelText('Cash amount')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Set opening cash' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Cash amount'), '3000');
    await userEvent.type(screen.getByLabelText('Who took or gave it'), 'MAAM');
    await userEvent.type(screen.getByLabelText('Reason'), 'Taken home');
    await userEvent.click(
      within(screen.getByRole('form', { name: 'Cash taken out or put in' })).getByRole('button', { name: 'Save' })
    );
    await waitFor(() => expect(screen.getAllByTestId('cash-move')).toHaveLength(1));
    expect(num(screen.getByTestId('cash-closing').textContent)).toBe(5000 + cashIn - 3000);

    // put ₹500 in (change for the day)
    await userEvent.click(screen.getByRole('button', { name: 'Cash taken out / put in' }));
    // the amount box has the cursor, and "Set opening cash" is still there
    expect(screen.getByLabelText('Cash amount')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Set opening cash' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Put in' }));
    await userEvent.type(screen.getByLabelText('Cash amount'), '500');
    await userEvent.click(
      within(screen.getByRole('form', { name: 'Cash taken out or put in' })).getByRole('button', { name: 'Save' })
    );
    await waitFor(() => expect(num(screen.getByTestId('cash-closing').textContent)).toBe(5000 + cashIn - 2500));

    await userEvent.click(screen.getByRole('button', { name: /Undo cash taken out ₹3,000 by MAAM/ }));
    await waitFor(() => expect(num(screen.getByTestId('cash-closing').textContent)).toBe(5000 + cashIn + 500));
    expect(await daybook.people()).toContain('MAAM');
    confirm.mockRestore();
  });

  it('downloads the sheet', async () => {
    const created = vi.fn(() => 'blob:daybook');
    const revoke = vi.fn();
    const orig = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = created;
    URL.revokeObjectURL = revoke;
    const names = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function save() {
      names.push(this.download);
    });
    renderShell({ route: '/daybook', child: <DayBook /> });
    await screen.findByTestId('daybook-table');
    // demo mode hands over a CSV and says so
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV (demo)' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    // the demo hands over a CSV of the same sheet (the server sends the .xlsx)
    expect(names).toEqual([`day-book-${dateStr(0)}.csv`]);
    expect(created.mock.calls[0][0].size).toBeGreaterThan(100);
    const { blob } = await daybook.download(dateStr(0));
    const text = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsText(blob);
    });
    expect(text).toContain('PATIENT LIST');
    expect(text).toContain('CASH BAL');
    click.mockRestore();
    URL.createObjectURL = orig.create;
    URL.revokeObjectURL = orig.revoke;
  });
});
