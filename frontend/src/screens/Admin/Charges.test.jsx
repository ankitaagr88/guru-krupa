import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { admin, billing } from '../../api';
import { mockStore } from '../../mocks/adapters';
import Admin from './Admin';

const section = () => screen.getByRole('heading', { name: 'Standard charges' }).closest('section');
const labels = () =>
  Array.from(section().querySelectorAll('#chargeList tr input[type=text]'))
    .filter((_, i) => i % 2 === 0)
    .map((i) => i.value);

beforeEach(() => {
  mockStore.reset();
});

describe('Admin › Standard charges', () => {
  it('adds a charge with an amount, changes the amount, reorders and switches it off', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Standard charges' });
    await waitFor(() => expect(labels()).toContain('Consultation'));

    await userEvent.type(within(section()).getByLabelText('New charge'), 'OCT scan');
    await userEvent.type(within(section()).getByLabelText('New charge amount'), '1200');
    await userEvent.click(within(section()).getByRole('button', { name: '+ Add a charge' }));
    await waitFor(() => expect(labels()).toContain('OCT scan'));
    let row = (await admin.standardCharges.list()).find((c) => c.label === 'OCT scan');
    expect(row.amount).toBe(1200);

    const amt = within(section()).getByLabelText('Amount for OCT scan');
    fireEvent.change(amt, { target: { value: '1500' } });
    fireEvent.blur(amt);
    await waitFor(async () =>
      expect((await admin.standardCharges.list()).find((c) => c.label === 'OCT scan').amount).toBe(1500)
    );

    await userEvent.click(within(section()).getByLabelText('Move charge OCT scan up'));
    await waitFor(() => {
      const l = labels();
      expect(l.indexOf('OCT scan')).toBe(l.length - 2);
    });

    await userEvent.click(within(section()).getByLabelText('Charge OCT scan active'));
    await waitFor(async () =>
      expect((await billing.charges()).map((c) => c.label)).not.toContain('OCT scan')
    );
    row = (await admin.standardCharges.list()).find((c) => c.label === 'OCT scan');
    expect(row.active).toBe(false);
  });

  it('Admin › Medicines sets and clears the price per pack', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    const input = await screen.findByLabelText('Price per pack of Latanoprost 0.005% eye drops');
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: '320' } });
    fireEvent.blur(input);
    const priceOf = async () =>
      (await admin.medicines.list()).find((m) => m.name === 'Latanoprost 0.005% eye drops').price;
    await waitFor(async () => expect(await priceOf()).toBe(320));
    const again = screen.getByLabelText('Price per pack of Latanoprost 0.005% eye drops');
    fireEvent.change(again, { target: { value: '' } });
    fireEvent.blur(again);
    await waitFor(async () => expect(await priceOf()).toBeNull());
  });

  it('refuses to delete a charge that a bill uses and says to switch it off', async () => {
    window.confirm = () => true;
    await billing.save(8, {
      items: [{ label: 'Consultation', amount: 500, kind: 'charge', standardChargeId: 1 }],
    });
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Standard charges' });
    await userEvent.click(await within(section()).findByLabelText('Delete charge Consultation'));
    expect(await screen.findByText('Not allowed right now')).toBeInTheDocument();
    expect(screen.getByText(/switch it off instead/)).toBeInTheDocument();
    expect(labels()).toContain('Consultation');

    await userEvent.click(within(section()).getByLabelText('Delete charge Dilation'));
    await waitFor(() => expect(labels()).not.toContain('Dilation'));
  });
});
