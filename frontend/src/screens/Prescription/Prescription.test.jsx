import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell, renderWithProviders } from '../../test/utils';
import { inventory, prescriptions } from '../../api';
import { PrescriptionModal } from './index';
import PrescriptionsToday from './PrescriptionsToday';

const KIRAN = { id: 2, name: 'Kiran Vaghela', token: '#015', age: 34, sex: 'M' };
const LATANO = 'Latanoprost 0.005% eye drops';

async function addMed(name) {
  const search = await screen.findByLabelText('Medicine name');
  await userEvent.clear(search);
  await userEvent.type(search, name);
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
}

describe('PrescriptionModal', () => {
  beforeEach(() => {
    window.print = vi.fn();
  });

  it('saves a prescription, decrements stock by qtyGiven and toasts low stock', async () => {
    const before = (await inventory.list()).find((i) => i.name === LATANO).stock; // 4, reorder 6
    const onSaved = vi.fn();
    renderWithProviders(<PrescriptionModal visit={KIRAN} onClose={() => {}} onSaved={onSaved} />);

    await addMed(LATANO);
    const row = (await screen.findAllByTestId('med-row'))[0];
    expect(within(row).getByText('in list')).toBeInTheDocument();
    expect(within(row).getByText(/4 bottles in stock · low/)).toBeInTheDocument();

    fireEvent.change(within(row).getByLabelText(`Dosage for ${LATANO}`), {
      target: { value: '1 drop, both eyes, at night' },
    });
    fireEvent.change(within(row).getByLabelText(`Quantity given of ${LATANO}`), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const after = (await inventory.list()).find((i) => i.name === LATANO).stock;
    expect(after).toBe(before - 2);
    expect(await screen.findByText('📦 Running low')).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${LATANO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is down to 2 bottles`))
    ).toBeInTheDocument();
    const rx = await prescriptions.get(2);
    expect(rx.lines).toHaveLength(1);
    expect(rx.lines[0].qtyGiven).toBe(2);
    expect(rx.lines[0].dosage).toBe('1 drop, both eyes, at night');
  });

  it('shows the 409 message when the clinic has less stock than qtyGiven', async () => {
    renderWithProviders(<PrescriptionModal visit={{ id: 4, name: 'Falguni Shah' }} onClose={() => {}} />);
    await addMed('Ofloxacin eye ointment'); // 5 tubes
    const row = (await screen.findAllByTestId('med-row'))[0];
    fireEvent.change(within(row).getByLabelText('Quantity given of Ofloxacin eye ointment'), {
      target: { value: '9' },
    });
    expect(within(row).getByText('only 5 tubes left')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Not enough stock')).toBeInTheDocument();
    expect((await inventory.list()).find((i) => i.name === 'Ofloxacin eye ointment').stock).toBe(5);
  });

  it('prints in Hinglish with dosageLocal from the print payload', async () => {
    renderWithProviders(
      <PrescriptionModal visit={{ id: 3, name: 'Mahesh Desai', token: '#011' }} onClose={() => {}} />
    );
    await addMed('Moxifloxacin 0.5% eye drops');
    const row = (await screen.findAllByTestId('med-row'))[0];
    fireEvent.change(within(row).getByLabelText('Dosage for Moxifloxacin 0.5% eye drops'), {
      target: { value: '1 drop, both eyes, 3x daily' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Hinglish' }));
    await userEvent.click(screen.getByRole('button', { name: /Print/ }));

    const sheet = await screen.findByTestId('rx-print');
    expect(sheet).toHaveAttribute('data-lang', 'hinglish');
    expect(within(sheet).getByText('1 boond, dono aankhon mein, din mein 3 baar')).toBeInTheDocument();
    expect(within(sheet).getByText('1 drop, both eyes, 3x daily')).toBeInTheDocument(); // english under it
    expect(within(sheet).getByText('Guru Krupa Eye Hospital & Laser Center')).toBeInTheDocument();
    expect(within(sheet).getByText(/VIP Road, Vesu, Surat/)).toBeInTheDocument();
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    // language persisted with the prescription
    expect((await prescriptions.get(3)).printLanguage).toBe('hinglish');
  });

  it('loads an existing prescription and unmatched lines render as free text', async () => {
    renderWithProviders(<PrescriptionModal visit={{ id: 5, name: 'Bharat Oza' }} onClose={() => {}} />);
    const rows = await screen.findAllByTestId('med-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByDisplayValue('1 drop both eyes, twice daily')).toBeInTheDocument();
    expect(rows[1]).toHaveClass('manual');
  });
});

describe('PrescriptionsToday', () => {
  it('lists today’s patients with their Rx status and opens the modal', async () => {
    renderShell({ route: '/prescriptions', child: <PrescriptionsToday /> });
    expect(await screen.findByText('Bharat Oza')).toBeInTheDocument();
    const written = screen.getAllByText('Written');
    expect(written.length).toBeGreaterThanOrEqual(1);
    await userEvent.click(screen.getByRole('button', { name: 'Rx written' }));
    expect(screen.queryByText('Rasilaben Patel')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'All today' }));
    await userEvent.click(screen.getByText('Rasilaben Patel'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Print language')).toBeInTheDocument();
  });
});
