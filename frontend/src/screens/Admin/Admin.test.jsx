import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { admin, treatments } from '../../api';
import Admin from './Admin';

const stageLabels = () =>
  Array.from(document.querySelectorAll('#stageList tr input[type=text]')).map((i) => i.value);

describe('Admin', () => {
  it('adds a stage before Done, renames it and reorders with the arrows', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    expect(await screen.findByRole('heading', { name: 'Process stages' })).toBeInTheDocument();
    await waitFor(() => expect(stageLabels()).toContain('Done'));
    await userEvent.click(screen.getByRole('button', { name: '+ Add a stage' }));
    await waitFor(() => expect(stageLabels()).toContain('New stage'));
    let labels = stageLabels();
    expect(labels[labels.length - 1]).toBe('Done');
    expect(labels[labels.length - 2]).toBe('New stage');

    const input = screen.getByLabelText('Stage New stage');
    fireEvent.change(input, { target: { value: 'Counselling' } });
    fireEvent.blur(input);
    await waitFor(() => expect(stageLabels()).toContain('Counselling'));

    await userEvent.click(screen.getByLabelText('Move Counselling up'));
    await waitFor(() => {
      const l = stageLabels();
      expect(l.indexOf('Counselling')).toBe(l.length - 3);
    });
    const keys = (await admin.stages.list()).map((s) => s.key);
    expect(keys[keys.length - 1]).toBe('done');
  });

  it('refuses to delete a stage that still has patients (409) and shows the message', async () => {
    window.confirm = () => true;
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Process stages' });
    await userEvent.click(await screen.findByLabelText('Delete stage Registration'));
    expect(await screen.findByText('Not allowed right now')).toBeInTheDocument();
    expect(screen.getByText(/still has patients/)).toBeInTheDocument();
    expect(stageLabels()).toContain('Registration');
  });

  it('protocol steps: add, retime and reorder', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByText('Dilation protocol (in order)');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a step' }));
    const nameInput = await screen.findByLabelText('Drop New drop 3');
    expect(nameInput).toBeInTheDocument();
    const mins = screen.getByLabelText('Minutes for New drop 3');
    fireEvent.change(mins, { target: { value: '25' } });
    fireEvent.blur(mins);
    await waitFor(async () => {
      const steps = await admin.protocolSteps.list();
      expect(steps[2]).toMatchObject({ name: 'New drop 3', minutes: 25 });
    });
    await userEvent.click(screen.getByLabelText('Move New drop 3 up'));
    await waitFor(async () => {
      const steps = await admin.protocolSteps.list();
      expect(steps[1].name).toBe('New drop 3');
    });
  });

  it('adds a staff member with a role and can deactivate them', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Staff & roles' });
    await userEvent.click(screen.getByRole('button', { name: '+ Add a staff member' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Meena Patel');
    await userEvent.type(within(dialog).getByLabelText('Username'), 'meena');
    await userEvent.type(within(dialog).getByLabelText('Password'), 'meena123');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'ot_staff');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add staff' }));
    const row = (await screen.findByText('Meena Patel')).closest('tr');
    expect(within(row).getByText('meena')).toBeInTheDocument();
    expect(within(row).getByLabelText('Role for Meena Patel')).toHaveValue('ot_staff');
    await userEvent.click(within(row).getByLabelText('Meena Patel active'));
    await waitFor(() => expect(screen.getByText('Meena Patel').closest('tr')).toHaveClass('staff-inactive'));
    const staff = await admin.staff.list();
    expect(staff.find((s) => s.username === 'meena')).toMatchObject({ role: 'ot_staff', active: false });
    expect(staff.find((s) => s.username === 'meena').password).toBeUndefined();
  });

  it('referral source needs-detail toggle', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Referral sources' });
    const sw = screen.getByLabelText('BNI asks for a name');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByLabelText('BNI asks for a name')).toHaveAttribute('aria-checked', 'true')
    );
    expect((await admin.referralSources.list()).find((r) => r.key === 'bni').needsDetail).toBe(true);
  });

  it('medicines: add one by name from the modal, rename inline, deactivate and show inactive', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Medicines' });
    expect(await screen.findByLabelText('Name of Aquaray Gel')).toHaveValue('Aquaray Gel');
    // no detail columns any more
    expect(screen.queryByLabelText('Type of Aquaray Gel')).toBeNull();
    expect(screen.queryByText('Medicine types')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '+ Add a medicine' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a medicine' });
    await userEvent.type(within(dialog).getByLabelText('Medicine name'), 'Moxicip');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add medicine' }));
    expect(await screen.findByLabelText('Name of Moxicip')).toHaveValue('Moxicip');
    const meds = await admin.medicines.list();
    const moxicip = meds.find((m) => m.name === 'Moxicip');
    expect(moxicip).toBeTruthy();

    const name = screen.getByLabelText('Name of Moxicip');
    fireEvent.change(name, { target: { value: 'Moxicip D' } });
    fireEvent.blur(name);
    await waitFor(async () => expect((await admin.medicines.list()).some((m) => m.name === 'Moxicip D')).toBe(true));

    await userEvent.click(screen.getByLabelText('Moxicip D active'));
    await waitFor(() => expect(screen.queryByLabelText('Name of Moxicip D')).toBeNull());
    expect((await admin.medicines.list()).some((m) => m.name === 'Moxicip D')).toBe(false);
    await userEvent.click(screen.getByLabelText('Show inactive medicines'));
    const row = await screen.findByTestId(`medicine-${moxicip.id}`);
    expect(row).toHaveClass('staff-inactive');
    await userEvent.click(within(row).getByLabelText('Moxicip D active'));
    await waitFor(() =>
      expect(screen.getByTestId(`medicine-${moxicip.id}`)).not.toHaveClass('staff-inactive')
    );
    expect((await admin.medicines.list()).some((m) => m.name === 'Moxicip D')).toBe(true);
  });


  it('diagnoses: add, rename, switch off, and set a standard treatment that then shows as set', async () => {
    window.confirm = () => true;
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Diagnoses & treatment standards' });
    expect(await screen.findByLabelText('Diagnosis Dry eye')).toHaveValue('Dry eye');

    await userEvent.type(screen.getByLabelText('New diagnosis'), 'Uveitis');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a diagnosis' }));
    const uv = await screen.findByLabelText('Diagnosis Uveitis');
    expect(uv).toHaveValue('Uveitis');
    fireEvent.change(uv, { target: { value: 'Anterior uveitis' } });
    fireEvent.blur(uv);
    await waitFor(async () =>
      expect((await treatments.diagnoses()).some((d) => d.name === 'Anterior uveitis')).toBe(true)
    );

    // standard editor: Glaucoma has history (Bharat Oza's seeded Rx) -> offered as the starting point
    await userEvent.click(screen.getByLabelText('Standard treatment for Glaucoma'));
    const dialog = await screen.findByRole('dialog', { name: /Standard treatment · Glaucoma/ });
    expect(await within(dialog).findByTestId('tx-source')).toHaveTextContent('most common prescription across 1 past prescription');
    expect(within(dialog).getAllByTestId('tx-line')).toHaveLength(2);
    await userEvent.click(within(dialog).getByLabelText('Remove Latanoprost 0.005% eye drops'));
    fireEvent.change(within(dialog).getByLabelText('Dosage for Timolol 0.5% eye drops'), { target: { value: '1 drop, both eyes, 2x daily' } });
    await userEvent.type(within(dialog).getByLabelText('Add a medicine to the standard'), 'Aquaray');
    await userEvent.click((await screen.findAllByTestId('med-option'))[0]);
    expect(within(dialog).getAllByTestId('tx-line')).toHaveLength(2);
    await userEvent.click(within(dialog).getByTestId('tx-save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const glaucoma = (await treatments.diagnoses()).find((d) => d.name === 'Glaucoma');
    expect(glaucoma.hasStandard).toBe(true);
    const std = await treatments.standard(glaucoma.id);
    expect(std.source).toBe('admin');
    expect(std.lines.map((l) => l.name).sort()).toEqual(['Aquaray Gel', 'Timolol 0.5% eye drops']);
    expect(std.lines.find((l) => l.name.startsWith('Timolol')).dosage).toBe('1 drop, both eyes, 2x daily');
    await waitFor(() =>
      expect(screen.getByLabelText('Standard treatment for Glaucoma')).toHaveTextContent('Set by doctor')
    );

    // switch off
    await userEvent.click(screen.getByLabelText('Diagnosis Anterior uveitis active'));
    await waitFor(async () =>
      expect((await treatments.diagnoses()).some((d) => d.name === 'Anterior uveitis')).toBe(false)
    );
  });

  it('OT slots & procedures: add a slot, switch one off (it leaves the picker), add and reorder procedures', async () => {
    window.confirm = () => true;
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'OT time slots' });
    expect(await screen.findByLabelText('Slot 9:00 AM')).toHaveValue('9:00 AM');

    await userEvent.type(screen.getByLabelText('New slot time'), '17:30');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a slot' }));
    expect(await screen.findByLabelText('Slot 5:30 PM')).toHaveValue('5:30 PM');
    await userEvent.type(screen.getByLabelText('New slot time'), 'half past');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a slot' }));
    expect(await screen.findByText(/is not a time/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Slot 9:45 AM active'));
    await waitFor(async () => expect((await admin.otSlots.list()).find((s) => s.label === '9:45 AM').active).toBe(false));
    const offered = (await (await import('../../api')).ot.slots('2030-01-01')).map((s) => s.timeSlot);
    expect(offered).not.toContain('9:45 AM');
    expect(offered).toContain('5:30 PM');

    await userEvent.type(screen.getByLabelText('New procedure'), 'Pterygium excision');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a procedure' }));
    expect(await screen.findByLabelText('Procedure Pterygium excision')).toHaveValue('Pterygium excision');
    await userEvent.click(screen.getByLabelText('Move procedure Pterygium excision up'));
    await waitFor(async () => {
      const names = (await admin.otProcedures.list()).map((p) => p.name);
      expect(names.indexOf('Pterygium excision')).toBe(names.length - 2);
    });
    // switched-off procedures leave the Schedule-surgery list
    await userEvent.click(screen.getByLabelText('Procedure LASIK active'));
    await waitFor(async () => expect((await (await import('../../api')).config.get()).otProcedures).not.toContain('LASIK'));
  });

  it('import: upload a KiviHealth patient CSV, columns are matched, preview then import (twice = no change)', async () => {
    window.confirm = () => true;
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Import from KiviHealth' });
    const csv = [
      '#,Name,Contact,Gender,Age(Y),Local Id,Area,City',
      '1,A N TIWARI,9727898614,Male,71,GK2341,-,Surat',
      '2,Rasilaben Patel,98250 12345,Female,62,GK0001,VESU,Surat',
      '3,,9999999999,Male,30,GK9999,,Surat',
    ].join('\n');
    const file = new File([csv], 'patients.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [file] } });
    expect(await screen.findByTestId('import-file-note')).toHaveTextContent('patients.csv · 3 rows');
    expect(screen.getByRole('radio', { name: 'Patients' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Column for Name')).toHaveValue('Name');
    expect(screen.getByLabelText('Column for KiviHealth id')).toHaveValue('Local Id');
    expect(screen.getByLabelText('Column for Phone')).toHaveValue('Contact');
    expect(screen.queryByTestId('import-missing')).toBeNull();

    await userEvent.click(screen.getByTestId('import-preview'));
    const result = await screen.findByTestId('import-result');
    expect(result).toHaveTextContent('1 new');
    expect(result).toHaveTextContent('1 updated'); // Rasilaben exists in the demo data -> gets her KiviHealth id
    expect(result).toHaveTextContent('1 skipped');
    expect(result).toHaveTextContent('no name');
    const before = (await (await import('../../api')).patients.list()).length;

    await userEvent.click(screen.getByTestId('import-run'));
    expect(await screen.findByTestId('import-done')).toHaveTextContent('1 added, 1 updated');
    const api = await import('../../api');
    const after = await api.patients.list();
    expect(after.length).toBe(before + 1);
    const tiwari = after.find((p) => p.name === 'A N TIWARI');
    expect(tiwari).toMatchObject({ externalId: 'GK2341', phone: '9727898614', sex: 'M', age: 71, address: 'Surat' });

    // same file again -> nothing new
    await userEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [file] } });
    await screen.findByTestId('import-file-note');
    await userEvent.click(screen.getByTestId('import-preview'));
    expect(await screen.findByTestId('import-result')).toHaveTextContent('0 new');
  });
});
