import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RECEPTION, renderShell } from '../../test/utils';
import { ot as otApi, otTeam } from '../../api';
import { mockStore } from '../../mocks/adapters';
import { dateStr } from '../../mocks/data';
import OT from './OT';

function renderOT() {
  return renderShell({ route: '/ot', child: <OT /> });
}

describe('OT screen (F6)', () => {
  beforeEach(() => {
    mockStore.reset();
  });

  it('shows today\'s cases with slot and status, and per-day counts on the strip', async () => {
    renderOT();
    const row = await screen.findByTestId('ot-row-1');
    expect(row).toHaveTextContent('Rujavana Madhani');
    expect(row).toHaveTextContent('9:00 AM');
    expect(row).toHaveTextContent('Scheduled');
    // count pill on today's date pill
    const pill = document.querySelector(`.date-pill[data-date="${dateStr(0)}"]`);
    await waitFor(() => expect(within(pill).getByText('1')).toBeInTheDocument());
    // the +2 day pill has Kulpal Singh
    await userEvent.click(document.querySelector(`.date-pill[data-date="${dateStr(2)}"]`));
    expect(await screen.findByText('Kulpal Singh')).toBeInTheDocument();
  });

  it('new-case modal: booked slots are disabled, a 409 conflict shows an error', async () => {
    renderOT();
    await screen.findByTestId('ot-row-1');
    await userEvent.click(screen.getByText('+ Schedule surgery'));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByLabelText('Patient name'), 'Test Patient');
    const booked = await within(dialog).findByRole('radio', { name: /9:00 AM/ });
    expect(booked).toBeDisabled();
    expect(booked).toHaveTextContent('Rujavana Madhani');

    // pick a free slot, then simulate the server-side race → 409
    await userEvent.click(within(dialog).getByRole('radio', { name: /9:45 AM/ }));
    const err = new Error('conflict');
    err.response = { status: 409, data: { detail: "Time slot '9:45 AM' is already booked on that date" } };
    const spy = vi.spyOn(otApi, 'create').mockRejectedValueOnce(err);
    await userEvent.click(within(dialog).getByText('Schedule'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already booked/);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ patientName: 'Test Patient', date: dateStr(0), timeSlot: '9:45 AM' })
    );
    spy.mockRestore();

    // second try goes through and the row appears
    await userEvent.click(within(dialog).getByText('Schedule'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Test Patient')).toBeInTheDocument();
  });

  it('picks an existing patient by search and creates the case with patientId', async () => {
    renderOT();
    await screen.findByTestId('ot-row-1');
    await userEvent.click(screen.getByText('+ Schedule surgery'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Search patients'), 'Falg');
    await userEvent.click(await within(dialog).findByText('Falguni Shah'));
    expect(within(dialog).getByTestId('ot-picked-patient')).toHaveTextContent('Falguni Shah');
    await userEvent.click(within(dialog).getByRole('radio', { name: /2:15 PM/ }));
    const spy = vi.spyOn(otApi, 'create');
    await userEvent.click(within(dialog).getByText('Schedule'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ patientId: 4, timeSlot: '2:15 PM' })));
    spy.mockRestore();
  });

  it('case drawer sends only the changed nested keys in a debounced PATCH', async () => {
    renderOT();
    await userEvent.click(await screen.findByTestId('ot-row-1'));
    const drawer = document.getElementById('otCaseDrawer');
    await waitFor(() => expect(drawer).toHaveClass('show'));
    expect(within(drawer).getByTestId('ot-case-status')).toHaveTextContent('Scheduled');

    // Pre-op biometry grid shows the seeded values
    expect(within(drawer).getByLabelText('AL (axial length) R')).toHaveValue('22.90mm');

    const spy = vi.spyOn(otApi, 'update');
    await userEvent.click(within(drawer).getByRole('tab', { name: 'Post-op' }));
    const sph = within(drawer).getByLabelText('R SPH');
    await userEvent.type(sph, '-0.25');
    expect(sph).toHaveValue('-0.25');
    expect(spy).not.toHaveBeenCalled(); // debounced
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(spy).toHaveBeenCalledWith(1, { postOp: { finalRx: { R: { sph: '-0.25' } } } });

    // Billing: lens tier + mediclaim flush immediately, total updates from the server
    await userEvent.click(within(drawer).getByRole('tab', { name: 'Billing' }));
    await userEvent.click(within(drawer).getByRole('radio', { name: /Toric IOL/ }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(1, { billing: { lensTier: 'toric' } }));
    await waitFor(() => expect(within(drawer).getByTestId('ot-total')).toHaveTextContent('₹38,000'));
    await userEvent.click(within(drawer).getByRole('switch', { name: 'Mediclaim' }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(1, { billing: { mediclaim: true } }));
    spy.mockRestore();

    // OT team starts with the clinic's surgeon
    await userEvent.click(within(drawer).getByRole('tab', { name: 'Operative' }));
    expect(within(drawer).getByLabelText('Name 1')).toHaveValue('Dr. Anu Juneja Pathak');
    expect(within(drawer).getByLabelText('Role 1')).toHaveValue('surgeon');

    // Status follows the start time
    await userEvent.click(within(within(drawer).getByTestId('ot-times')).getByRole('button', { name: 'Now' }));
    await waitFor(() => expect(within(drawer).getByTestId('ot-case-status')).toHaveTextContent('In progress'));
    await waitFor(() => expect(screen.getByTestId('ot-row-1')).toHaveTextContent('In progress'));
  });

  it('scan biometry report fills the pre-op grid and reports unreadable values', async () => {
    renderOT();
    await userEvent.click(await screen.findByTestId('ot-row-1'));
    const drawer = document.getElementById('otCaseDrawer');
    await waitFor(() => expect(drawer).toHaveClass('show'));
    expect(within(drawer).getByLabelText('AL (axial length) L')).toHaveValue('22.80mm');

    const input = within(drawer).getByTestId('biometry-input');
    fireEvent.change(input, { target: { files: [new File(['hbm1'], 'hbm1.jpg', { type: 'image/jpeg' })] } });
    expect(await within(drawer).findByTestId('biometry-busy')).toBeInTheDocument();
    const note = await within(drawer).findByTestId('biometry-note', {}, { timeout: 4000 });
    expect(note).toHaveTextContent('Filled 7 values');
    expect(note).toHaveTextContent('Could not read: K2 (L)');
    expect(within(drawer).getByLabelText('AL (axial length) L')).toHaveValue('23.05mm');
    expect(within(drawer).getByLabelText('K1 L')).toHaveValue('43.50D');
    expect(within(drawer).getByLabelText('K2 R')).toHaveValue('44.10D');
    // the unreadable value is left as it was, not overwritten
    expect(within(drawer).getByLabelText('K2 L')).toHaveValue('43.93D');
  });

  async function openCase1(user) {
    if (user) renderShell({ route: '/ot', child: <OT />, user });
    else renderOT();
    await userEvent.click(await screen.findByTestId('ot-row-1'));
    const drawer = document.getElementById('otCaseDrawer');
    await waitFor(() => expect(drawer).toHaveClass('show'));
    return drawer;
  }

  it('surgery times: a start time makes it In progress, an end time Completed; end before start refused; Reopen clears the end', async () => {
    const drawer = await openCase1();
    const d = within(drawer);
    const status = () => d.getByTestId('ot-case-status');

    fireEvent.change(d.getByLabelText('Start time'), { target: { value: '09:10' } });
    await waitFor(() => expect(status()).toHaveTextContent('In progress'));
    await waitFor(() => expect(d.getByLabelText('End time')).not.toBeDisabled());

    fireEvent.change(d.getByLabelText('End time'), { target: { value: '09:00' } });
    expect(await d.findByRole('alert')).toHaveTextContent('End time must be after the start time.');
    expect(status()).toHaveTextContent('In progress');

    fireEvent.change(d.getByLabelText('End time'), { target: { value: '09:45' } });
    await waitFor(() => expect(status()).toHaveTextContent('Completed'));
    expect(d.getByTestId('ot-duration')).toHaveTextContent('Took 35 min');
    await waitFor(() => expect(screen.getByTestId('ot-times-1')).toHaveTextContent('9:10 am–9:45 am'));
    const saved = await otApi.get(1);
    expect(saved.operative).toMatchObject({ startTime: '09:10', endTime: '09:45' });
    expect(saved.status).toBe('completed');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(d.getByRole('button', { name: /Reopen/ }));
    await waitFor(() => expect(status()).toHaveTextContent('In progress'));
    expect(d.getByLabelText('End time')).toHaveValue('');
    expect((await otApi.get(1)).operative.endTime).toBe('');
    confirm.mockRestore();

    // clearing the start time steps back to Scheduled
    fireEvent.change(d.getByLabelText('Start time'), { target: { value: '' } });
    await waitFor(() => expect(status()).toHaveTextContent('Scheduled'));
  });

  it('surgery times are read-only for reception (no Reopen either)', async () => {
    const drawer = await openCase1(RECEPTION);
    const d = within(drawer);
    expect(d.getByLabelText('Start time')).toBeDisabled();
    expect(d.getByLabelText('End time')).toBeDisabled();
    expect(d.queryByRole('button', { name: 'Now' })).toBeNull();
    expect(d.getByText('Times are entered by the doctor / OT staff.')).toBeInTheDocument();
    expect(d.getByRole('button', { name: /Cancel surgery/ })).toBeInTheDocument();
  });

  it('OT team: add an outside doctor from the list — qualification and fee filled — and it is saved', async () => {
    const drawer = await openCase1(RECEPTION); // any staff may edit the team
    const d = within(drawer);
    await userEvent.click(d.getByRole('tab', { name: 'Operative' }));
    await userEvent.click(d.getByRole('button', { name: '+ Add team member' }));
    await userEvent.selectOptions(d.getByLabelText('Role 2'), 'anaesthetist');
    const spy = vi.spyOn(otApi, 'update');
    await userEvent.type(d.getByLabelText('Name 2'), 'Dr. Kavita Shah');
    expect(d.getByLabelText('Qualification 2')).toHaveValue('MD Anaesthesia');
    expect(d.getByLabelText('Reg. no. 2')).toHaveValue('G-24518');
    expect(d.getByLabelText('Outside (not our staff) 2')).toBeChecked();
    expect(d.getByLabelText('Fee 2')).toHaveValue('2500');
    expect(d.getByTestId('ot-team-row-2')).toHaveTextContent('Outside');
    await waitFor(
      () => expect(spy).toHaveBeenLastCalledWith(1, { billing: { team: expect.any(Array) } }),
      { timeout: 2000 }
    );
    const team = spy.mock.calls.at(-1)[1].billing.team;
    expect(team).toHaveLength(2);
    expect(team[1]).toMatchObject({
      roleKey: 'anaesthetist',
      roleLabel: 'Anaesthetist',
      name: 'Dr. Kavita Shah',
      qualification: 'MD Anaesthesia',
      external: true,
      partnerId: 1,
      fee: 2500,
    });
    expect(team[1]._id).toBeUndefined();
    spy.mockRestore();
    await waitFor(async () => expect((await otApi.get(1)).billing.teamFees).toBe(2500));
    expect(d.queryByRole('button', { name: 'Save to outside-doctor list' })).toBeNull();
  });

  it('OT team: an outside doctor without a qualification shows the server message', async () => {
    const drawer = await openCase1();
    const d = within(drawer);
    await userEvent.click(d.getByRole('tab', { name: 'Operative' }));
    await userEvent.click(d.getByRole('button', { name: '+ Add team member' }));
    await userEvent.selectOptions(d.getByLabelText('Role 2'), 'anaesthetist');
    await userEvent.type(d.getByLabelText('Name 2'), 'Dr. Visiting');
    await userEvent.click(d.getByLabelText('Outside (not our staff) 2'));
    expect(
      await d.findByText(/OT team row 2 \(Anaesthetist, Dr\. Visiting\): an outside doctor needs a medical qualification/,
        {}, { timeout: 2000 })
    ).toBeInTheDocument();
    // typing the qualification saves it; admins may add the person to the outside-doctor list
    await userEvent.type(d.getByLabelText('Qualification 2'), 'MD Anaesthesia');
    await waitFor(async () => expect((await otApi.get(1)).billing.team).toHaveLength(2), { timeout: 2000 });
    await userEvent.click(d.getByRole('button', { name: 'Save to outside-doctor list' }));
    await waitFor(() => expect(d.queryByRole('button', { name: 'Save to outside-doctor list' })).toBeNull());
    const partners = await otTeam.admin.partners();
    expect(partners.map((p) => p.name)).toContain('Dr. Visiting');
  });

  it('billing tab: lens line + a line per team member, fees editable, total = lens + fees', async () => {
    const drawer = await openCase1();
    const d = within(drawer);
    await userEvent.click(d.getByRole('tab', { name: 'Billing' }));
    await userEvent.click(d.getByRole('radio', { name: /Toric IOL/ }));
    await waitFor(() => expect(d.getByTestId('ot-total')).toHaveTextContent('₹38,000'));
    const lines = d.getAllByTestId('ot-bill-team-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('Surgeon — Dr. Anu Juneja Pathak');
    const fee = d.getByLabelText('Fee for Dr. Anu Juneja Pathak');
    await userEvent.clear(fee);
    await userEvent.type(fee, '5000');
    expect(d.getByTestId('ot-total')).toHaveTextContent('₹43,000');
    await waitFor(async () => expect((await otApi.get(1)).billing.total).toBe(43000), { timeout: 2000 });
  });

  it('the seeded completed case shows the outside anaesthetist, the times and total', async () => {
    renderOT();
    await screen.findByTestId('ot-row-1');
    await userEvent.click(document.querySelector(`.date-pill[data-date="${dateStr(-3)}"]`));
    expect(await screen.findByTestId('ot-times-3')).toHaveTextContent('2:20 pm–2:55 pm');
    await userEvent.click(screen.getByTestId('ot-row-3'));
    const drawer = document.getElementById('otCaseDrawer');
    await waitFor(() => expect(drawer).toHaveClass('show'));
    await userEvent.click(within(drawer).getByRole('tab', { name: 'Billing' }));
    expect(within(drawer).getByText(/Anaesthetist — Dr. Kavita Shah \(Outside\)/)).toBeInTheDocument();
    expect(within(drawer).getByTestId('ot-total')).toHaveTextContent('₹31,000');
  });
});
