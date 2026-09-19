import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { ot as otApi } from '../../api';
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

    // Operative surgeon default
    await userEvent.click(within(drawer).getByRole('tab', { name: 'Operative' }));
    expect(within(drawer).getByLabelText('Surgeon')).toHaveValue('Dr. Anu Juneja Pathak');

    // Status
    await userEvent.click(within(drawer).getByText('Start surgery'));
    await waitFor(() => expect(within(drawer).getByTestId('ot-case-status')).toHaveTextContent('In progress'));
    await waitFor(() => expect(screen.getByTestId('ot-row-1')).toHaveTextContent('In progress'));
  });
});
