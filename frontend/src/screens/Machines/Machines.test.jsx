import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('idb', () => import('../../test/fakeIdb'));

import { resetFakeIdb } from '../../test/fakeIdb';
import { renderShell } from '../../test/utils';
import { _resetForTests, listPending } from '../../offline/captureQueue';
import { readings as readingsApi } from '../../api';
import { mockStore } from '../../mocks/adapters';
import Machines from './Machines';

const file = () => new File(['printout'], 'printout.jpg', { type: 'image/jpeg' });

function renderMachines({ device = 'mobile', route = '/machines' } = {}) {
  sessionStorage.setItem('gk_device', device); // the capture flows are the phone's; desktop only intakes images
  return renderShell({ route, child: <Machines /> });
}

// Step 1: the machine, step 2: the patient.
async function pick(machineKey, patientName) {
  await userEvent.click(await screen.findByTestId(`machine-${machineKey}`));
  await userEvent.click(await screen.findByText(patientName));
}

describe('Machines screen (F5) — machine first, then the patient', () => {
  beforeEach(() => {
    globalThis.indexedDB = {};
    resetFakeIdb();
    _resetForTests();
    mockStore.reset();
    localStorage.removeItem('gk_machine');
  });

  it('lists every machine first; then today\'s patients (not done), filtered by name or token', async () => {
    renderMachines();
    expect(await screen.findByText('Which machine are you using?')).toBeInTheDocument();
    expect(await screen.findByTestId('machine-hnt1p_tono')).toBeInTheDocument();
    expect(screen.getByTestId('machine-tbut_schirmer')).toHaveTextContent('typed in');
    expect(screen.queryByPlaceholderText('Search by name or token…')).toBeNull();

    await userEvent.click(screen.getByTestId('machine-hnt1p_tono'));
    expect(screen.getByTestId('machine-chosen')).toHaveTextContent('HNT-1P');
    const input = await screen.findByPlaceholderText('Search by name or token…');
    await screen.findByText('Rasilaben Patel');
    expect(screen.getByText('Kiran Vaghela')).toBeInTheDocument();

    await userEvent.type(input, '#012');
    await waitFor(() => expect(screen.queryByText('Rasilaben Patel')).not.toBeInTheDocument());
    expect(screen.getByText('Falguni Shah')).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, 'kiran');
    expect(screen.getByText('Kiran Vaghela')).toBeInTheDocument();
    expect(screen.queryByText('Falguni Shah')).not.toBeInTheDocument();

    // "Change machine" goes back to the machine list
    await userEvent.click(screen.getByTestId('change-machine'));
    expect(await screen.findByText('Which machine are you using?')).toBeInTheDocument();
  });

  it('remembers the machine on this device and offers "Next patient on <machine>"', async () => {
    const { unmount } = renderMachines();
    await pick('hnt1p_tono', 'Kiran Vaghela');
    expect(await screen.findByTestId('capture-machine')).toHaveTextContent('HNT-1P');
    await userEvent.click(screen.getByTestId('next-patient'));
    expect(await screen.findByText('Falguni Shah')).toBeInTheDocument();
    expect(screen.getByTestId('machine-chosen')).toHaveTextContent('HNT-1P');
    unmount();

    renderMachines(); // next time the screen opens at the same machine
    expect(await screen.findByTestId('machine-chosen')).toHaveTextContent('HNT-1P');
  });

  it('desktop: no camera controls — add a printout image for the chosen machine, values appear for approval', async () => {
    renderMachines({ device: 'desktop' });
    await pick('hnt1p_tono', 'Kiran Vaghela');
    expect(await screen.findByText('Readings')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-toggle')).not.toBeVisible();
    expect(screen.queryByText(/Photograph the printout/)).toBeNull();
    await userEvent.click(screen.getByTestId('intake-add'));
    fireEvent.change(screen.getByTestId('capture-input'), { target: { files: [file()] } });
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Needs approval'), { timeout: 4000 });
    const card = screen.getByTestId('reading-status').closest('.reading-card');
    expect(within(card).getByLabelText('IOP (R)')).toHaveValue('13');
    expect(within(card).getByTestId('approve-reading')).toBeInTheDocument();
  });

  it('captures a printout: reading goes pending → done and the values render', async () => {
    renderMachines();
    await pick('hnt1p_tono', 'Kiran Vaghela');
    expect(await screen.findByText('Capturing')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('capture-btn'));
    fireEvent.change(screen.getByTestId('capture-input'), { target: { files: [file()] } });

    const status = await screen.findByTestId('reading-status', {}, { timeout: 3000 });
    expect(['Pending', 'Processing']).toContain(status.textContent);
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Needs approval'), { timeout: 4000 });

    const card = screen.getByTestId('reading-status').closest('.reading-card');
    expect(within(card).getByLabelText('IOP (R)')).toHaveValue('13');
    expect(within(card).getByLabelText('CCT (L)')).toHaveValue('508');
    // a low-confidence field is highlighted in coral
    expect(card.querySelector('.reading-val.low')).not.toBeNull();
    // the queue is empty again after the upload
    expect(await listPending()).toHaveLength(0);

    // F13: a person approves the values → status Approved, stamp shown, photo gone
    expect(within(card).getByText('Show printout')).toBeInTheDocument();
    await userEvent.click(within(card).getByTestId('approve-reading'));
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Approved'));
    expect(within(card).getByTestId('reading-approved')).toHaveTextContent(/Approved by .* photo deleted/);
    expect(within(card).queryByText('Show printout')).toBeNull();
    expect(within(card).queryByTestId('approve-reading')).toBeNull();
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('queues offline and uploads on reconnect with the same clientUuid', async () => {
    const spy = vi.spyOn(readingsApi, 'capture');
    renderMachines();
    await pick('hrk8000a_ref', 'Falguni Shah');
    await screen.findByText('Capturing');

    await userEvent.click(screen.getByTestId('offline-toggle'));
    expect(await screen.findByTestId('connectivity-banner')).toHaveTextContent('No connection');

    await userEvent.click(screen.getByTestId('capture-btn'));
    fireEvent.change(screen.getByTestId('capture-input'), { target: { files: [file()] } });

    await screen.findByText(/Waiting to upload \(1\)/);
    const [queued] = await listPending();
    expect(queued.machineKey).toBe('hrk8000a_ref');
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText('waiting to upload')).toBeInTheDocument();

    // back online → the sync loop flushes the queue
    await userEvent.click(screen.getByTestId('offline-toggle'));
    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 3000 });
    expect(spy.mock.calls[0][0].clientUuid).toBe(queued.uuid);
    expect(spy.mock.calls[0][0].machineKey).toBe('hrk8000a_ref');
    await waitFor(async () => expect(await listPending()).toHaveLength(0));
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Needs approval'), { timeout: 4000 });
    spy.mockRestore();
  });

  it('/machines?visit=<id> with a remembered machine goes straight to the capture for that patient', async () => {
    localStorage.setItem('gk_machine', 'hnt1p_tono');
    renderMachines({ route: '/machines?visit=2' }); // Kiran Vaghela's visit
    expect(await screen.findByTestId('capture-machine')).toHaveTextContent('HNT-1P');
    expect(screen.getByText('Kiran Vaghela')).toBeInTheDocument();
    // "Next patient" is a free pick again (the link is used once)
    await userEvent.click(screen.getByTestId('next-patient'));
    expect(await screen.findByPlaceholderText('Search by name or token…')).toBeInTheDocument();
  });

  it('/machines?visit=<id> with no machine remembered asks the machine, then captures for that patient', async () => {
    renderMachines({ route: '/machines?visit=4', device: 'desktop' }); // Falguni Shah
    expect(await screen.findByTestId('machine-for-patient')).toHaveTextContent('Reading for Falguni Shah');
    await userEvent.click(await screen.findByTestId('machine-hrk8000a_ref'));
    expect(await screen.findByTestId('capture-machine')).toHaveTextContent('HRK-8000A');
    expect(screen.getAllByText('Falguni Shah').length).toBeGreaterThan(0);
    expect(localStorage.getItem('gk_machine')).toBe('hrk8000a_ref');
  });

  it('desktop: "Printout unreadable? Type the values instead" opens the typed-entry form', async () => {
    renderMachines({ device: 'desktop' });
    await pick('hnt1p_tono', 'Kiran Vaghela');
    await userEvent.click(await screen.findByText('Printout unreadable? Type the values instead'));
    const form = await screen.findByTestId('manual-form');
    await userEvent.type(within(form).getByLabelText('IOP (R)'), '15');
    await userEvent.click(within(form).getByText('Save values'));
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Needs approval'));
  });

  it('a typed-in machine opens the typed-entry form straight away and saves a done reading', async () => {
    renderMachines();
    await pick('tbut_schirmer', 'Mahesh Desai');
    const form = await screen.findByTestId('manual-form');
    await userEvent.type(within(form).getByLabelText('TBUT (R)'), '8s');
    await userEvent.click(within(form).getByText('Save values'));
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Needs approval'));
    expect(screen.getByLabelText('TBUT (R)')).toHaveValue('8s');
  });
});
