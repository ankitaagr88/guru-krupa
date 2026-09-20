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

function renderMachines({ device = 'mobile' } = {}) {
  sessionStorage.setItem('gk_device', device); // the capture flows are the phone's; desktop only intakes images
  return renderShell({ route: '/machines', child: <Machines /> });
}

describe('Machines screen (F5)', () => {
  beforeEach(() => {
    globalThis.indexedDB = {};
    resetFakeIdb();
    _resetForTests();
    mockStore.reset();
  });

  it('lists today\'s patients (not done) and filters by name or token', async () => {
    renderMachines();
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
  });

  it('desktop: no camera controls — pick the machine, add an image, values appear for approval', async () => {
    renderMachines({ device: 'desktop' });
    await userEvent.click(await screen.findByText('Kiran Vaghela'));
    expect(await screen.findByText('Readings for')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-toggle')).not.toBeVisible();
    expect(screen.queryByText(/Photograph the machine/)).toBeNull();
    const add = screen.getByTestId('intake-add');
    expect(add).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Machine the printout is from'), 'hnt1p_tono');
    expect(add).toBeEnabled();
    await userEvent.click(add);
    fireEvent.change(screen.getByTestId('capture-input'), { target: { files: [file()] } });
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Done'), { timeout: 4000 });
    const card = screen.getByTestId('reading-status').closest('.reading-card');
    expect(within(card).getByLabelText('IOP (R)')).toHaveValue('13');
    expect(within(card).getByTestId('approve-reading')).toBeInTheDocument();
  });

  it('captures a printout: reading goes pending → done and the values render', async () => {
    renderMachines();
    await userEvent.click(await screen.findByText('Kiran Vaghela'));
    expect(await screen.findByText('Capturing for')).toBeInTheDocument();

    // machine picker from GET /machines (7 machines, TBUT is manual-only)
    const tono = await screen.findByTestId('machine-hnt1p_tono');
    expect(screen.getByTestId('machine-tbut_schirmer')).toHaveTextContent('typed in');

    await userEvent.click(tono);
    const input = screen.getByTestId('capture-input');
    fireEvent.change(input, { target: { files: [file()] } });

    const status = await screen.findByTestId('reading-status', {}, { timeout: 3000 });
    expect(['Pending', 'Processing']).toContain(status.textContent);
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Done'), { timeout: 4000 });

    const card = screen.getByTestId('reading-status').closest('.reading-card');
    expect(within(card).getByLabelText('IOP (R)')).toHaveValue('13');
    expect(within(card).getByLabelText('CCT (L)')).toHaveValue('508');
    // a low-confidence field is highlighted in coral
    expect(card.querySelector('.reading-val.low')).not.toBeNull();
    // the queue is empty again after the upload
    expect(await listPending()).toHaveLength(0);

    // F13: a person approves the values → status Approved, stamp shown, photo gone
    expect(within(card).getByText('Show photo')).toBeInTheDocument();
    await userEvent.click(within(card).getByTestId('approve-reading'));
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Approved'));
    expect(within(card).getByTestId('reading-approved')).toHaveTextContent(/Approved by .* photo deleted/);
    expect(within(card).queryByText('Show photo')).toBeNull();
    expect(within(card).queryByTestId('approve-reading')).toBeNull();
    expect(screen.getByTestId('machine-hnt1p_tono')).toHaveTextContent('approved');
  });

  it('queues offline and uploads on reconnect with the same clientUuid', async () => {
    const spy = vi.spyOn(readingsApi, 'capture');
    renderMachines();
    await userEvent.click(await screen.findByText('Falguni Shah'));
    await screen.findByText('Capturing for');

    await userEvent.click(screen.getByTestId('offline-toggle'));
    expect(await screen.findByTestId('connectivity-banner')).toHaveTextContent('No connection');

    await userEvent.click(await screen.findByTestId('machine-hrk8000a_ref'));
    fireEvent.change(screen.getByTestId('capture-input'), { target: { files: [file()] } });

    await screen.findByText(/Waiting to upload \(1\)/);
    const [queued] = await listPending();
    expect(queued.machineKey).toBe('hrk8000a_ref');
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('machine-hrk8000a_ref')).toHaveTextContent('waiting to upload');

    // back online → the sync loop flushes the queue
    await userEvent.click(screen.getByTestId('offline-toggle'));
    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 3000 });
    expect(spy.mock.calls[0][0].clientUuid).toBe(queued.uuid);
    expect(spy.mock.calls[0][0].machineKey).toBe('hrk8000a_ref');
    await waitFor(async () => expect(await listPending()).toHaveLength(0));
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Done'), { timeout: 4000 });
    spy.mockRestore();
  });

  it('manual-only machines open the typed-entry form and save a done reading', async () => {
    renderMachines();
    await userEvent.click(await screen.findByText('Mahesh Desai'));
    await userEvent.click(await screen.findByTestId('machine-tbut_schirmer'));
    const form = await screen.findByTestId('manual-form');
    await userEvent.type(within(form).getByLabelText('TBUT (R)'), '8s');
    await userEvent.click(within(form).getByText('Save values'));
    await waitFor(() => expect(screen.getByTestId('reading-status')).toHaveTextContent('Done'));
    expect(screen.getByLabelText('TBUT (R)')).toHaveValue('8s');
  });
});
