import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { admin, daybook } from '../../api';
import { mockStore } from '../../mocks/adapters';
import Admin from './Admin';

/* Admin › Day book columns (lane M): the day book's money columns, and where medicines / typed
   lines / OT payments go. Standard charges pick their column too. */
const section = () => screen.getByRole('heading', { name: 'Day book columns' }).closest('section');
const labels = () =>
  Array.from(section().querySelectorAll('#headList tr input[aria-label^="Column "]')).map((i) => i.value);

beforeEach(() => {
  mockStore.reset();
});

describe('Admin › Day book columns', () => {
  it('adds, renames, reorders, switches off and deletes columns', { timeout: 20000 }, async () => {
    window.confirm = () => true;
    renderShell({ route: '/admin', child: <Admin /> });
    await screen.findByRole('heading', { name: 'Day book columns' });
    await waitFor(() => expect(labels()).toEqual(['OPD', 'MED', 'TEST', 'GLASSES', 'OT', 'OTHER']));

    await userEvent.type(within(section()).getByLabelText('New day book column'), 'CONTACT LENS');
    await userEvent.click(within(section()).getByRole('button', { name: '+ Add a column' }));
    await waitFor(() => expect(labels()).toContain('CONTACT LENS'));

    const name = within(section()).getByLabelText('Column CONTACT LENS');
    fireEvent.change(name, { target: { value: 'CL' } });
    fireEvent.blur(name);
    await waitFor(() => expect(labels()).toContain('CL'));

    await userEvent.click(within(section()).getByLabelText('Move column CL up'));
    await waitFor(() => expect(labels().slice(-2)).toEqual(['CL', 'OTHER']));

    await userEvent.click(within(section()).getByLabelText('Column CL active'));
    await waitFor(async () => expect((await daybook.heads()).map((h) => h.key)).not.toContain('cl'));

    // a column in use can't be deleted; an unused one can
    await userEvent.click(within(section()).getByLabelText('Delete column GLASSES'));
    expect(await screen.findByText(/switch it off instead/)).toBeInTheDocument();
    expect(labels()).toContain('GLASSES');
    await userEvent.click(within(section()).getByLabelText('Delete column CL'));
    await waitFor(() => expect(labels()).not.toContain('CL'));
  });

  it('sets where medicines, typed lines and OT payments go; a column in use there cannot be switched off', { timeout: 20000 }, async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    const box = await screen.findByTestId('daybook-settings');
    const typed = within(box).getByLabelText('Hand-typed bill lines start in');
    expect(typed).toHaveValue('other');
    await userEvent.selectOptions(typed, 'opd');
    await waitFor(async () => expect((await daybook.settings()).otherHead).toBe('opd'));

    await userEvent.click(within(section()).getByLabelText('Column MED active'));
    expect(await screen.findByText(/column for medicines/)).toBeInTheDocument();
    expect((await daybook.heads()).map((h) => h.key)).toContain('med');
  });

  it('Standard charges: each charge picks its day book column', { timeout: 20000 }, async () => {
    renderShell({ route: '/admin', child: <Admin /> });
    const charges = () => screen.getByRole('heading', { name: 'Standard charges' }).closest('section');
    await screen.findByRole('heading', { name: 'Standard charges' });
    const pick = await within(charges()).findByLabelText('Day book column for Perimetry');
    await waitFor(() => expect(pick).toHaveValue('test'));
    expect(within(charges()).getByLabelText('Day book column for Glasses')).toHaveValue('glasses');
    expect(within(charges()).getByLabelText('Amount for Glasses')).toHaveValue('0');
    await userEvent.selectOptions(pick, 'opd');
    await waitFor(async () =>
      expect((await admin.standardCharges.list()).find((c) => c.label === 'Perimetry').accountHeadKey).toBe('opd')
    );
  });
});
