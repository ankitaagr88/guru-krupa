import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { otTeam } from '../../api';
import { mockStore } from '../../mocks/adapters';
import { OtPartnersSection, OtTeamRolesSection } from './OtAdmin';

// Admin's `run(fn, okMsg)`: true when fn succeeded.
const run = async (fn) => {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
};
const section = (id) => within(document.querySelector(`[aria-labelledby="${id}"]`));

describe('Admin › OT team roles and outside doctors', () => {
  beforeEach(() => mockStore.reset());

  it('team roles: add with a usual fee, rename, change the fee, reorder, switch off', async () => {
    renderWithProviders(<OtTeamRolesSection run={run} />);
    expect(await screen.findByRole('heading', { name: 'OT team roles' })).toBeInTheDocument();
    const s = section('h-otroles');
    await waitFor(() => expect(s.getByLabelText('Role Anaesthetist')).toBeInTheDocument());

    await userEvent.type(s.getByLabelText('New team role'), 'Circulating nurse');
    await userEvent.type(s.getByLabelText('Usual fee for the new role'), '500');
    await userEvent.click(s.getByRole('button', { name: '+ Add a role' }));
    await waitFor(() => expect(s.getByLabelText('Usual fee for Circulating nurse')).toHaveValue('500'));

    const fee = s.getByLabelText('Usual fee for Anaesthetist');
    fireEvent.change(fee, { target: { value: '3000' } });
    fireEvent.blur(fee);
    await waitFor(async () =>
      expect((await otTeam.admin.roles()).find((r) => r.key === 'anaesthetist').defaultFee).toBe(3000)
    );

    const name = s.getByLabelText('Role Circulating nurse');
    fireEvent.change(name, { target: { value: 'Floor nurse' } });
    fireEvent.blur(name);
    await waitFor(() => expect(s.getByLabelText('Role Floor nurse')).toBeInTheDocument());

    await userEvent.click(s.getByLabelText('Move role Floor nurse up'));
    await waitFor(async () => {
      const keys = (await otTeam.admin.roles()).map((r) => r.key);
      expect(keys.indexOf('circulating_nurse')).toBe(keys.length - 2);
    });

    await userEvent.click(s.getByRole('switch', { name: 'Role Floor nurse active' }));
    await waitFor(() => expect(s.getByTestId('ot-role-circulating_nurse')).toHaveClass('staff-inactive'));
    const offered = (await otTeam.options()).roles.map((r) => r.key);
    expect(offered).not.toContain('circulating_nurse');
  });

  it('outside doctors: qualification needed to add; edit, usual role, switch off', async () => {
    renderWithProviders(<OtPartnersSection run={run} />);
    expect(await screen.findByRole('heading', { name: 'Outside doctors & partners' })).toBeInTheDocument();
    const s = section('h-otpartners');
    await waitFor(() => expect(s.getByLabelText('Name for Dr. Kavita Shah')).toBeInTheDocument());

    await userEvent.type(s.getByLabelText('New outside doctor name'), 'Dr. R. Mehta');
    const add = s.getByRole('button', { name: '+ Add outside doctor' });
    expect(add).toBeDisabled(); // no qualification yet
    await userEvent.type(s.getByLabelText('New outside doctor qualification'), 'MS Ophthalmology');
    await userEvent.type(s.getByLabelText('New outside doctor reg. no.'), 'G-9001');
    await userEvent.selectOptions(s.getByLabelText('New outside doctor usual role'), 'assistant_surgeon');
    await userEvent.type(s.getByLabelText('New outside doctor usual fee'), '4000');
    await userEvent.click(add);
    await waitFor(() => expect(s.getByLabelText('Qualification for Dr. R. Mehta')).toHaveValue('MS Ophthalmology'));
    expect(s.getByLabelText('Usual role for Dr. R. Mehta')).toHaveValue('assistant_surgeon');
    expect(s.getByLabelText('Usual fee for Dr. R. Mehta')).toHaveValue('4000');
    expect(s.getByLabelText('New outside doctor name')).toHaveValue('');

    const qual = s.getByLabelText('Qualification for Dr. R. Mehta');
    fireEvent.change(qual, { target: { value: 'MS (Ophth.), FICO' } });
    fireEvent.blur(qual);
    await waitFor(async () =>
      expect((await otTeam.admin.partners()).find((p) => p.name === 'Dr. R. Mehta').qualification).toBe('MS (Ophth.), FICO')
    );

    await userEvent.click(s.getByRole('switch', { name: 'Dr. R. Mehta active' }));
    await waitFor(async () =>
      expect((await otTeam.options()).partners.map((p) => p.name)).not.toContain('Dr. R. Mehta')
    );
  });
});
