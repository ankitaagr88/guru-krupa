import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell, renderWithProviders, RECEPTION } from '../../test/utils';
import { inventory, prescriptions, treatments } from '../../api';
import { mockStore } from '../../mocks/adapters';
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

  it('saving does not touch stock; the front desk confirms "bought here" at billing, which does', async () => {
    const before = (await inventory.list()).find((i) => i.name === LATANO).stock; // 4, reorder 6
    const onSaved = vi.fn();
    renderWithProviders(<PrescriptionModal visit={KIRAN} onClose={() => {}} onSaved={onSaved} />);

    await addMed(LATANO);
    const row = (await screen.findAllByTestId('med-row'))[0];
    expect(within(row).getByText('From our medicine list')).toBeInTheDocument();
    expect(within(row).getByText(/4 bottles in stock · low/)).toBeInTheDocument();

    fireEvent.change(within(row).getByLabelText(`Dosage for ${LATANO}`), {
      target: { value: '1 drop, both eyes, at night' },
    });
    fireEvent.change(within(row).getByLabelText(`Quantity given of ${LATANO}`), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // the doctor saving moved nothing
    expect((await inventory.list()).find((i) => i.name === LATANO).stock).toBe(before);
    const rx = await prescriptions.get(2);
    expect(rx.lines).toHaveLength(1);
    expect(rx.lines[0]).toMatchObject({ qtyGiven: 2, dispensedQty: 0, dosage: '1 drop, both eyes, at night', inStock: 4 });

    // front desk confirms the purchase -> stock down by 2, low-stock flagged
    const after = await prescriptions.dispense(2, rx.lines[0].id, 2);
    expect(after.lines[0].dispensedQty).toBe(2);
    expect((await inventory.list()).find((i) => i.name === LATANO).stock).toBe(before - 2);
    expect(after.lowStock.map((i) => i.name)).toContain(LATANO);
    // undo puts it back
    await prescriptions.undispense(2, rx.lines[0].id);
    expect((await inventory.list()).find((i) => i.name === LATANO).stock).toBe(before);
  });

  it('confirming more than the clinic has is refused and changes nothing', async () => {
    renderWithProviders(<PrescriptionModal visit={{ id: 4, name: 'Falguni Shah' }} onClose={() => {}} />);
    await addMed('Ofloxacin eye ointment'); // 5 tubes
    const row = (await screen.findAllByTestId('med-row'))[0];
    fireEvent.change(within(row).getByLabelText('Quantity given of Ofloxacin eye ointment'), {
      target: { value: '9' },
    });
    expect(within(row).getByText('only 5 tubes left')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Prescription saved');
    const rx = await prescriptions.get(4);
    await expect(prescriptions.dispense(4, rx.lines[0].id, 9)).rejects.toMatchObject({ response: { status: 409 } });
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

  it('loads an existing prescription; seeded lines on the medicine list read so, with their stock', async () => {
    renderWithProviders(<PrescriptionModal visit={{ id: 5, name: 'Bharat Oza' }} onClose={() => {}} />);
    const rows = await screen.findAllByTestId('med-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByDisplayValue('1 drop both eyes, twice daily')).toBeInTheDocument();
    // Latanoprost is on the list: no "typed by hand" next to a stock line any more
    expect(within(rows[1]).getByText('From our medicine list')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Typed by hand')).toBeNull();
    expect(within(rows[1]).getByText(/in stock/)).toBeInTheDocument();
    // the seeded lines have ids, so the front desk's "Bought here" finds them
    const rx = await prescriptions.get(5);
    const after = await prescriptions.dispense(5, rx.lines[1].id, 1);
    expect(after.lines[1].dispensedQty).toBe(1);
  });

  it('opens wide with the medicine search focused; Print is the main button and Save the second', async () => {
    renderWithProviders(<PrescriptionModal visit={KIRAN} onClose={() => {}} />);
    const search = await screen.findByLabelText('Medicine name');
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Print' })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: /^Save/ })).toHaveClass('btn-ghost');
    expect(screen.getByRole('heading', { name: 'Prescription' })).toBeInTheDocument();
  });
});

describe('Medicine picker & brand/composition (F12)', () => {
  beforeEach(() => {
    window.print = vi.fn();
  });

  it('picker shows the medicine name only and a picked line is "From our medicine list"', async () => {
    renderWithProviders(<PrescriptionModal visit={{ id: 7, name: 'Ilaben Chauhan' }} onClose={() => {}} />);
    const search = await screen.findByLabelText('Medicine name');
    await userEvent.type(search, 'aquaray');
    const opts = await screen.findAllByTestId('med-option');
    const aquaray = opts.find((o) => within(o).queryByText('Aquaray Gel'));
    expect(aquaray).toBeTruthy();
    expect(within(aquaray).getByText('Aquaray Gel').tagName).toBe('B');
    // no composition / type / pack details anywhere in the row
    expect(within(aquaray).queryByText(/Carboxymethylcellulose/)).toBeNull();
    expect(within(aquaray).queryByText(/10 ml/)).toBeNull();
    expect(aquaray.querySelector('.med-type-chip')).toBeNull();
    await userEvent.click(aquaray);
    const row = (await screen.findAllByTestId('med-row'))[0];
    expect(within(row).getByText('Aquaray Gel')).toBeInTheDocument();
    expect(within(row).getByText('From our medicine list')).toBeInTheDocument();
    expect(row.querySelector('.med-type-chip')).toBeNull();
    expect(within(row).queryByText(/Carboxymethylcellulose/)).toBeNull();

    // typing the name and pressing Add also resolves to the master row
    await addMed('mosi lp');
    const rows = await screen.findAllByTestId('med-row');
    expect(within(rows[1]).getByText('MOSI LP')).toBeInTheDocument();
    expect(within(rows[1]).getByText('From our medicine list')).toBeInTheDocument();
  });

  it('typing part of a name + Enter picks the highlighted suggestion, not the typed text', async () => {
    renderWithProviders(<PrescriptionModal visit={{ id: 7, name: 'Ilaben Chauhan' }} onClose={() => {}} />);
    const search = await screen.findByLabelText('Medicine name');
    await userEvent.type(search, 'moxi{Enter}'); // Enter before the suggestions arrive still waits for them
    const row = (await screen.findAllByTestId('med-row'))[0];
    expect(within(row).getByText('Moxifloxacin 0.5% eye drops')).toBeInTheDocument();
    expect(within(row).getByText('From our medicine list')).toBeInTheDocument();
    expect(search).toHaveValue('');

    // arrow keys move the highlight; the list ends with an explicit "as typed" row
    await userEvent.type(search, 'tim');
    const first = (await screen.findAllByTestId('med-option'))[0];
    expect(first).toHaveAttribute('aria-selected', 'true');
    const typed = screen.getByTestId('med-option-typed');
    expect(typed).toHaveTextContent('Add “tim” as typed');
    await userEvent.keyboard('{ArrowUp}'); // wraps round to the last row: "as typed"
    expect(typed).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    const rows = await screen.findAllByTestId('med-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('tim')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Typed by hand')).toBeInTheDocument();
  });

  it('print sheet: medicine name bold and the dosage, nothing else', async () => {
    renderWithProviders(
      <PrescriptionModal visit={{ id: 6, name: 'Sangita Rana', token: '#007' }} onClose={() => {}} />
    );
    await addMed('Aquaray Gel');
    const row = (await screen.findAllByTestId('med-row'))[0];
    fireEvent.change(within(row).getByLabelText('Dosage for Aquaray Gel'), {
      target: { value: '1 drop, both eyes, at night' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Print/ }));
    const sheet = await screen.findByTestId('rx-print');
    const name = within(sheet).getByText('Aquaray Gel');
    expect(name.tagName).toBe('B');
    expect(name).toHaveClass('rx-print-brand');
    expect(within(sheet).queryByText(/Carboxymethylcellulose/)).toBeNull();
    expect(sheet.querySelector('.rx-print-type')).toBeNull();
    expect(within(sheet).getByText('1 drop, both eyes, at night')).toBeInTheDocument();
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });

  it('free text shows "Typed by hand" (no stock line); an admin can add it to the medicine list and the line re-matches', async () => {
    renderWithProviders(<PrescriptionModal visit={{ id: 1, name: 'Rasilaben Patel' }} onClose={() => {}} />);
    await addMed('Lubrex Plus');
    const row = (await screen.findAllByTestId('med-row'))[0];
    expect(within(row).getByText('Typed by hand')).toBeInTheDocument();
    expect(within(row).queryByText(/in stock|not stocked/)).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Add Lubrex Plus to medicine list' }));
    const form = within(row).getByTestId('medicine-form');
    expect(within(form).getByLabelText('Medicine name')).toHaveValue('Lubrex Plus');
    await userEvent.click(within(form).getByRole('button', { name: 'Add to list' }));
    await waitFor(() => expect(within(row).getByText('From our medicine list')).toBeInTheDocument());
    const meds = await prescriptions.medicines({ q: 'lubrex' });
    expect(meds[0]).toMatchObject({ name: 'Lubrex Plus' });
  });

  it('non-admins see the hint but no "Add to medicine list" link', async () => {
    renderWithProviders(<PrescriptionModal visit={{ id: 1, name: 'Rasilaben Patel' }} onClose={() => {}} />, {
      user: RECEPTION,
    });
    await addMed('Some Unknown Drops');
    const row = (await screen.findAllByTestId('med-row')).find((r) =>
      within(r).queryByText('Some Unknown Drops')
    );
    expect(within(row).getByText('Typed by hand')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /to medicine list/ })).toBeNull();
  });
});

describe('Diagnosis auto-fill (B15/F17)', () => {
  beforeEach(() => {
    mockStore.reset();
    window.print = vi.fn();
  });

  it('picking a diagnosis fills the lines from history, and the diagnosis is saved with the prescription', async () => {
    // Bharat Oza (id 5) is seeded with a Glaucoma prescription (Timolol + Latanoprost) -> history of 1
    renderWithProviders(<PrescriptionModal visit={{ id: 7, name: 'Ilaben Chauhan' }} onClose={() => {}} />);
    const select = await screen.findByLabelText('Diagnosis');
    expect(select).toHaveValue('');
    const glaucoma = (await treatments.diagnoses()).find((d) => d.name === 'Glaucoma');
    await userEvent.selectOptions(select, String(glaucoma.id));
    const note = await screen.findByTestId('rx-fill-note');
    expect(note).toHaveTextContent('Filled 2 medicines from the most common prescription across 1 past patient');
    const rows = await screen.findAllByTestId('med-row');
    expect(rows).toHaveLength(2);
    // both appear in 100% of the history -> alphabetical
    expect(within(rows[0]).getByText(LATANO)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Timolol 0.5% eye drops')).toBeInTheDocument();
    expect(screen.getByLabelText('Dosage for Timolol 0.5% eye drops')).toHaveValue('1 drop both eyes, twice daily');

    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await screen.findByRole('button', { name: /^Saved at / });
    expect((await prescriptions.get(7)).diagnosisId).toBe(glaucoma.id);
    // now the history counts 2 prescriptions for Glaucoma
    expect((await treatments.standard(glaucoma.id)).historyCount).toBe(2);
  });

  it('an admin-set standard wins over history; a diagnosis with nothing says so; existing lines: "Replace medicines / Keep mine"', async () => {
    const dry = (await treatments.diagnoses()).find((d) => d.name === 'Dry eye');
    await treatments.admin.saveStandard(dry.id, [{ name: LATANO, dosage: '1 drop at night' }]);
    const cataract = (await treatments.diagnoses()).find((d) => d.name === 'Cataract');

    renderWithProviders(<PrescriptionModal visit={{ id: 1, name: 'Rasilaben Patel' }} onClose={() => {}} />);
    const select = await screen.findByLabelText('Diagnosis');
    await userEvent.selectOptions(select, String(cataract.id));
    expect(await screen.findByTestId('rx-fill-note')).toHaveTextContent('No standard treatment yet');

    await userEvent.selectOptions(select, String(dry.id));
    expect(await screen.findByTestId('rx-fill-note')).toHaveTextContent("Filled 1 medicine from Dr Anu's standard treatment");
    expect(within((await screen.findAllByTestId('med-row'))[0]).getByText(LATANO)).toBeInTheDocument();

    // switching diagnosis with lines present asks in the page (no browser pop-up); "Keep mine" keeps them
    window.confirm = vi.fn(() => false);
    const glaucoma = (await treatments.diagnoses()).find((d) => d.name === 'Glaucoma');
    await userEvent.selectOptions(select, String(glaucoma.id));
    const ask = await screen.findByTestId('rx-replace-ask');
    expect(ask).toHaveTextContent('Replace the 1 medicine already listed with the usual treatment for Glaucoma');
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep mine' }));
    expect(await screen.findByTestId('rx-fill-note')).toHaveTextContent('Kept the medicines already listed');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('med-row')).toHaveLength(1);

    // …and "Replace medicines" puts in the usual treatment
    const dryAgain = (await treatments.diagnoses()).find((d) => d.name === 'Dry eye');
    await userEvent.selectOptions(select, String(dryAgain.id)); // back to Dry eye (1 line listed)
    await userEvent.click(within(await screen.findByTestId('rx-replace-ask')).getByRole('button', { name: 'Replace medicines' }));
    expect(await screen.findByTestId('rx-fill-note')).toHaveTextContent("Dr Anu's standard treatment");
    expect(screen.queryByTestId('rx-replace-ask')).toBeNull();
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
