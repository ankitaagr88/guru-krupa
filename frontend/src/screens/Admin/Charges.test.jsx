import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { admin, billing } from '../../api';
import { mockStore } from '../../mocks/adapters';
import Admin from './Admin';

const section = () => screen.getByRole('heading', { name: 'Standard charges' }).closest('section');
const labels = () =>
  Array.from(section().querySelectorAll('#chargeList tr input[aria-label^="Charge "]')).map((i) => i.value);

beforeEach(() => {
  mockStore.reset();
});

describe('Admin › Standard charges', () => {
  it('adds a charge with an amount, changes the amount, reorders and switches it off', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Standard charges' });
    await waitFor(() => expect(labels()).toContain('Consultation / new file'));
    // Dr Anu's tests are priced per eye, under their heading
    expect(within(section()).getByLabelText('Both eyes amount for Perimetry')).toHaveValue('4000');
    expect(within(section()).getByLabelText('Heading for Perimetry')).toHaveValue('Tests');

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
    // a both-eyes price and a heading; clearing the both-eyes price makes it one price again
    const both = within(section()).getByLabelText('Both eyes amount for OCT scan');
    fireEvent.change(both, { target: { value: '2200' } });
    fireEvent.blur(both);
    const heading = within(section()).getByLabelText('Heading for OCT scan');
    fireEvent.change(heading, { target: { value: 'Tests' } });
    fireEvent.blur(heading);
    await waitFor(async () =>
      expect((await admin.standardCharges.list()).find((c) => c.label === 'OCT scan')).toMatchObject({
        amountBothEyes: 2200,
        groupLabel: 'Tests',
      })
    );
    fireEvent.change(within(section()).getByLabelText('Both eyes amount for OCT scan'), { target: { value: '' } });
    fireEvent.blur(within(section()).getByLabelText('Both eyes amount for OCT scan'));
    await waitFor(async () =>
      expect((await admin.standardCharges.list()).find((c) => c.label === 'OCT scan').amountBothEyes).toBeNull()
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
      items: [{ label: 'Consultation / new file', amount: 700, kind: 'charge', standardChargeId: 1 }],
    });
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Standard charges' });
    await userEvent.click(await within(section()).findByLabelText('Delete charge Consultation / new file'));
    expect(await screen.findByText('Not allowed right now')).toBeInTheDocument();
    expect(screen.getByText(/switch it off instead/)).toBeInTheDocument();
    expect(labels()).toContain('Consultation / new file');

    await userEvent.click(within(section()).getByLabelText('Delete charge Macular OCT'));
    await waitFor(() => expect(labels()).not.toContain('Macular OCT'));
  });
});
