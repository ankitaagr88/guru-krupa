import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { inventory } from '../../api';
import Inventory from './Inventory';

describe('Inventory', () => {
  it('lists stock, highlights low items and toasts them on load', async () => {
    renderShell({ route: '/inventory', child: <Inventory /> });
    expect(await screen.findByText('Cyclopentolate 1%')).toBeInTheDocument();
    const row = screen.getByTestId('inv-row-2'); // Cyclopentolate: 3 of reorder 5
    expect(row).toHaveClass('inv-row-low');
    expect(within(row).getByText('Low stock')).toBeInTheDocument();
    expect(within(screen.getByTestId('inv-row-1')).getByText('OK')).toBeInTheDocument();
    const toasts = await screen.findAllByText('📦 Running low');
    expect(toasts.length).toBeGreaterThanOrEqual(2); // Cyclopentolate + Latanoprost
    expect(screen.getByText(/Cyclopentolate 1% is down to 3 bottles/)).toBeInTheDocument();
  });

  it('adjust modal with delta/reason/note updates stock and records a movement', async () => {
    renderShell({ route: '/inventory', child: <Inventory /> });
    const row = await screen.findByTestId('inv-row-2');
    await userEvent.click(within(row).getByText('Adjust…'));
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
    await userEvent.click(within(screen.getByTestId('inv-row-2')).getByText('History'));
    expect(await screen.findByText('Stock received')).toBeInTheDocument();
    expect(screen.getByText('Batch B12')).toBeInTheDocument();
  });

  it('quick +/- and add item', async () => {
    renderShell({ route: '/inventory', child: <Inventory /> });
    const row = await screen.findByTestId('inv-row-1'); // Tropicamide 8
    await userEvent.click(within(row).getByLabelText('Add one Tropicamide 0.8%'));
    await waitFor(() => expect(screen.getByTestId('stock-1')).toHaveTextContent('9'));

    await userEvent.type(screen.getByLabelText('Item name'), 'Fluorescein strips');
    await userEvent.type(screen.getByLabelText('Unit'), 'packs');
    await userEvent.type(screen.getByLabelText('Opening stock'), '3');
    await userEvent.type(screen.getByLabelText('Reorder level'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const newRow = (await screen.findAllByText('Fluorescein strips', { selector: 'td' }))[0].closest('tr');
    expect(within(newRow).getByText('4 packs')).toBeInTheDocument();
    expect(within(newRow).getByText('Low stock')).toBeInTheDocument();
  });
});
