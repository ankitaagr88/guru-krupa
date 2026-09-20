import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { inventory } from '../../api';
import Inventory from './Inventory';

import { mockStore } from '../../mocks/adapters';

describe('Inventory', () => {
  beforeEach(() => mockStore.reset());

  it('lists stock, highlights low items and toasts them on load', async () => {
    renderShell({ route: '/inventory', child: <Inventory /> });
    expect(await screen.findByText('Cyclopentolate 1%')).toBeInTheDocument();
    const row = screen.getByTestId('inv-row-2'); // Cyclopentolate: 3 of reorder 5
    expect(row).toHaveClass('inv-row-low');
    expect(within(row).getByText('Low stock')).toBeInTheDocument();
    expect(within(screen.getByTestId('inv-row-1')).getByText('OK')).toBeInTheDocument();
    const toasts = await screen.findAllByText('Running low');
    expect(toasts.length).toBeGreaterThanOrEqual(2); // Cyclopentolate + Latanoprost
    expect(screen.getByText(/Cyclopentolate 1% is down to 3 bottles/)).toBeInTheDocument();
  });

  it('adjust modal with delta/reason/note updates stock and records a movement', async () => {
    renderShell({ route: '/inventory', child: <Inventory /> });
    const row = await screen.findByTestId('inv-row-2');
    await userEvent.click(within(row).getByRole('button', { name: /More actions/ }));
    await userEvent.click(within(row).getByRole('menuitem', { name: 'Adjust stock…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Change in stock'), { target: { value: '5' } });
    expect(within(dialog).getByText(/After this:/)).toHaveTextContent('8');
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'received');
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Batch B12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() => expect(screen.getByTestId('stock-2')).toHaveTextContent('8'));
    expect(within(screen.getByTestId('inv-row-2')).getByText('OK')).toBeInTheDocument();
    const moves = await inventory.movements(2);
    expect(moves[0]).toMatchObject({ delta: 5, reason: 'received', note: 'Batch B12' });

    // history drawer
    await userEvent.click(within(screen.getByTestId('inv-row-2')).getByRole('button', { name: /More actions/ }));
    await userEvent.click(within(screen.getByTestId('inv-row-2')).getByRole('menuitem', { name: 'History' }));
    expect(await screen.findByText('Stock received')).toBeInTheDocument();
    expect(screen.getByText('Batch B12')).toBeInTheDocument();
  });

  it('low rows come first with an Ordered button; Received adds the stock; add item', async () => {
    renderShell({ route: '/inventory', child: <Inventory /> });
    const first = (await screen.findAllByTestId(/^inv-row-/))[0]; // Cyclopentolate (3 of 5) — low, so on top
    expect(first).toHaveTextContent('Cyclopentolate 1%');
    expect(within(first).getByText('Low stock')).toBeInTheDocument();
    // the healthy Tropicamide row has no Ordered button of its own (it is behind "More")
    const trop = screen.getByTestId('inv-row-1');
    expect(within(trop).queryByRole('button', { name: 'Ordered…' })).toBeNull();
    expect(within(trop).getByText('dilation drop')).toBeInTheDocument();

    await userEvent.click(within(first).getByRole('button', { name: 'Ordered…' }));
    const dialog = await screen.findByRole('dialog', { name: /Order placed/ });
    fireEvent.change(within(dialog).getByLabelText('Quantity ordered'), { target: { value: '10' } });
    await userEvent.click(within(dialog).getByTestId('inv-order-save'));
    await waitFor(() => expect(screen.getByTestId('inv-row-2')).toHaveTextContent('10 on order'));

    await userEvent.click(within(screen.getByTestId('inv-row-2')).getByRole('button', { name: 'Received…' }));
    const recv = await screen.findByRole('dialog', { name: /Stock received/ });
    expect(within(recv).getByLabelText('Change in stock')).toHaveValue('10');
    fireEvent.change(within(recv).getByLabelText('Change in stock'), { target: { value: '6' } });
    await userEvent.click(within(recv).getByRole('button', { name: 'Add to stock' }));
    await waitFor(() => expect(screen.getByTestId('stock-2')).toHaveTextContent('9'));
    expect(screen.getByTestId('inv-row-2')).toHaveTextContent('4 on order'); // shortfall stays on order
    expect(within(screen.getByTestId('inv-row-2')).queryByText('—')).toBeNull(); // last received now shown

    await userEvent.type(screen.getByLabelText('Item name'), 'Fluorescein strips');
    await userEvent.type(screen.getByLabelText('Unit'), 'packs');
    await userEvent.type(screen.getByLabelText('Opening stock'), '3');
    await userEvent.type(screen.getByLabelText('Reorder level'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const newRow = (await screen.findAllByText('Fluorescein strips', { selector: 'td' }))[0].closest('tr');
    expect(within(newRow).getByText(/reorder at 4/)).toBeInTheDocument();
    expect(within(newRow).getByText('Low stock')).toBeInTheDocument();
  });

  it('add item via the medicine picker fills the name and sends medicineId', async () => {
    renderShell({ route: '/inventory', child: <Inventory /> });
    await screen.findByTestId('inv-row-1');
    await userEvent.type(screen.getByLabelText('Item name'), 'mosi');
    const opt = (await screen.findAllByTestId('med-option')).find((o) => within(o).queryByText('MOSI LP'));
    expect(opt.querySelector('.med-type-chip')).toBeNull();
    await userEvent.click(opt);
    expect(screen.getByLabelText('Item name')).toHaveValue('MOSI LP');
    expect(screen.getByTestId('inv-link-hint')).toHaveTextContent('Linked to the medicine list: MOSI LP');
    await userEvent.type(screen.getByLabelText('Unit'), 'bottles');
    await userEvent.type(screen.getByLabelText('Opening stock'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findAllByText('MOSI LP', { selector: 'td' });
    const item = (await inventory.list()).find((i) => i.name === 'MOSI LP');
    expect(item.medicineId).toBeGreaterThan(0);
    expect(item.stock).toBe(6);
  });
});
