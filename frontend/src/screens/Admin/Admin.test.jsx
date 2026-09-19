import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { admin } from '../../api';
import Admin from './Admin';

const stageLabels = () =>
  Array.from(document.querySelectorAll('#stageList tr input[type=text]')).map((i) => i.value);

describe('Admin', () => {
  it('adds a stage before Done, renames it and reorders with the arrows', async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    expect(await screen.findByText('Process stages')).toBeInTheDocument();
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
    await screen.findByText('Process stages');
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
    await screen.findByText('Staff & roles');
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
    await screen.findByText('Referral sources');
    const sw = screen.getByLabelText('BNI asks for a name');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByLabelText('BNI asks for a name')).toHaveAttribute('aria-checked', 'true')
    );
    expect((await admin.referralSources.list()).find((r) => r.key === 'bni').needsDetail).toBe(true);
  });
});
