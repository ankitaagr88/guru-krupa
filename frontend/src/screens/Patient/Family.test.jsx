import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN, renderShell, renderWithProviders } from '../../test/utils';
import { family, intake, mockStore, patients } from '../../mocks/adapters';
import { session } from '../../api/client';
import { RelationsSection } from '../Admin/FamilyAdmin';
import Register from '../Register/Register';
import Queue from '../Queue/Queue';
import Patient from './Patient';

/* Families on one mobile number (lane E1): the new-patient prompt, the patient page's family card,
   the staff /register page and Admin › Family relations — all in demo mode. */

const SLOW = 20000; // long click-through flows; slow when the machine is busy
const byName = (name) => mockStore.state.patients.find((p) => p.name === name);

beforeEach(() => {
  mockStore.reset();
  delete mockStore.state.relations; // the demo relations list lives beside the store
  localStorage.clear();
  window.scrollTo = vi.fn();
});

describe('New patient: "Add as a family member"', () => {
  it('links the new patient to the number\'s owner with the relation picked', async () => {
    render(
      <MemoryRouter initialEntries={['/queue/reg']}>
        <AppProviders initialUser={ADMIN}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/queue/:stage" element={<Queue />} />
            </Route>
          </Routes>
        </AppProviders>
      </MemoryRouter>
    );
    await waitFor(() => expect(document.querySelector('#board')).toHaveTextContent('Rasilaben Patel'));
    await userEvent.click(screen.getByRole('button', { name: '+ New patient' }));
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Jay Patel');
    await userEvent.type(screen.getByPlaceholderText('Phone number'), '98250 12345');

    const panel = await screen.findByTestId('same-phone');
    expect(within(panel).getByRole('button', { name: 'No — separate patient' })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Add as a family member' }));
    const join = screen.getByTestId('family-join');
    expect(join).toHaveTextContent('New family member of Rasilaben Patel');
    await within(join).findByRole('option', { name: 'बेटा (Son)' });
    await userEvent.selectOptions(within(join).getByLabelText('Their relation to Rasilaben Patel'), 'son');

    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText('Jay Patel added to the queue')).toBeInTheDocument();
    const jay = byName('Jay Patel');
    expect(jay.familyOwnerId).toBe(1);
    expect(jay.relationKey).toBe('son');
    const [read] = await patients.list({ q: 'Jay Patel' });
    expect(read.relationLabel).toBe('बेटा (Son)');
    expect(read.familyOwnerName).toBe('Rasilaben Patel');
  }, SLOW);
});

describe('Patient page: Family on this number', () => {
  it('shows the family and changes relation, owner and membership; adds a family member', async () => {
    const jay = await patients.create({ name: 'Jay Patel', phone: '98250 12345', age: 12, sex: 'M', familyOwnerId: 1, relationKey: 'son' });
    const mina = await patients.create({ name: 'Mina Patel', phone: '9825012345', age: 38, sex: 'F' });
    renderShell({
      route: `/patients/${jay.id}`,
      child: (
        <Routes>
          <Route path="/patients/:id" element={<Patient />} />
        </Routes>
      ),
    });
    expect(await screen.findByTestId('patient-family-line')).toHaveTextContent('बेटा (Son) of Rasilaben Patel');
    const card = await screen.findByTestId('family-card');
    await within(card).findByTestId('family-member-1');
    expect(within(card).getByTestId('family-member-1')).toHaveTextContent('Owns this number');
    expect(within(card).getByTestId(`family-member-${jay.id}`)).toHaveTextContent('Son');

    // Someone already on the number joins the family.
    const other = within(card).getByTestId(`family-other-${mina.id}`);
    await userEvent.click(within(other).getByRole('button', { name: 'Add to this family' }));
    await within(other).findByRole('option', { name: 'बहू (Daughter-in-law)' });
    await userEvent.selectOptions(within(other).getByLabelText("Mina Patel's relation to Rasilaben Patel"), 'daughter_in_law');
    await userEvent.click(within(other).getByRole('button', { name: 'Add to this family' }));
    await waitFor(() => expect(byName('Mina Patel').familyOwnerId).toBe(1));
    expect(byName('Mina Patel').relationKey).toBe('daughter_in_law');

    // Change relation.
    let row = await within(card).findByTestId(`family-member-${mina.id}`);
    await userEvent.click(within(row).getByRole('button', { name: 'Change relation' }));
    await userEvent.selectOptions(within(row).getByLabelText("Mina Patel's relation to Rasilaben Patel"), 'daughter');
    await userEvent.click(within(row).getByRole('button', { name: 'Save relation' }));
    await waitFor(() => expect(byName('Mina Patel').relationKey).toBe('daughter'));

    // Make Jay the owner: everyone re-points to him, Rasilaben becomes his mother.
    row = within(card).getByTestId(`family-member-${jay.id}`);
    await userEvent.click(within(row).getByRole('button', { name: 'Make owner of this number' }));
    await userEvent.selectOptions(within(row).getByLabelText("Rasilaben Patel's relation to Jay Patel"), 'mother');
    await userEvent.click(within(row).getByRole('button', { name: 'Make Jay the owner' }));
    await waitFor(() => expect(byName('Jay Patel').familyOwnerId).toBeNull());
    expect(byName('Rasilaben Patel')).toMatchObject({ familyOwnerId: jay.id, relationKey: 'mother' });
    expect(byName('Mina Patel').familyOwnerId).toBe(jay.id);
    await waitFor(() => expect(screen.getByTestId('patient-family-line')).toHaveTextContent('Owns this number · family of 3'));

    // Remove Mina from the family.
    row = within(card).getByTestId(`family-member-${mina.id}`);
    await userEvent.click(within(row).getByRole('button', { name: 'Remove from family' }));
    const confirm = within(row).getAllByRole('button', { name: 'Remove from family' });
    await userEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(byName('Mina Patel').familyOwnerId).toBeNull());

    // Add a new family member: the New patient form opens with the phone and the family chosen.
    await userEvent.click(within(card).getByTestId('family-add'));
    expect(await screen.findByRole('heading', { name: 'Add family member' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Phone number')).toHaveValue('98250 12345');
    const join = screen.getByTestId('family-join');
    expect(join).toHaveTextContent('New family member of Jay Patel');
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Baby Patel');
    await within(join).findByRole('option', { name: 'बेटी (Daughter)' });
    await userEvent.selectOptions(within(join).getByLabelText('Their relation to Jay Patel'), 'daughter');
    await userEvent.click(screen.getByRole('button', { name: 'Save family member' }));
    await waitFor(() => expect(byName('Baby Patel')).toBeTruthy());
    expect(byName('Baby Patel')).toMatchObject({ familyOwnerId: jay.id, relationKey: 'daughter' });
    await within(card).findByTestId(`family-member-${byName('Baby Patel').id}`);
  }, SLOW);
});

describe('Staff /register: add as a family member; the public page never links', () => {
  it('staff can add the new patient to the family on the number', async () => {
    session.set('mock-token-admin', ADMIN);
    render(
      <MemoryRouter initialEntries={['/register']}>
        <AppProviders initialUser={ADMIN}>
          <Routes>
            <Route path="/register" element={<Register />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>
    );
    await screen.findByTestId('reg-cond-Asthma');
    await userEvent.type(screen.getByLabelText(/Your full name/), 'Kavya Patel');
    await userEvent.type(screen.getByLabelText(/Mobile number/), '98250 12345');
    const panel = await screen.findByTestId('same-phone');
    await userEvent.click(within(panel).getByRole('button', { name: 'Add as a family member' }));
    const join = screen.getByTestId('family-join');
    await within(join).findByRole('option', { name: 'पोती / नातिन (Granddaughter)' });
    await userEvent.selectOptions(within(join).getByLabelText('Their relation to Rasilaben Patel'), 'granddaughter');
    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByTestId('reg-last')).toHaveTextContent('Kavya Patel added to the queue');
    expect(byName('Kavya Patel')).toMatchObject({ familyOwnerId: 1, relationKey: 'granddaughter' });
  }, SLOW);

  it('a public submission with family fields is not linked', async () => {
    const res = await intake.submit({ name: 'Sneaky Kid', phone: '98250 12345', familyOwnerId: 1, relationKey: 'son', website: '' });
    expect(Object.keys(res)).toEqual(['token']);
    expect(byName('Sneaky Kid').familyOwnerId ?? null).toBeNull();
  }, SLOW);
});

describe('Admin › Family relations', () => {
  const run = async (fn) => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };

  it('adds, renames, switches off and deletes relations; groups patients who share a number', async () => {
    window.confirm = vi.fn(() => true);
    await patients.create({ name: 'Son Owner', phone: '70000 12121' });
    await patients.create({ name: 'Son Member', phone: '7000012121', familyOwnerId: mockStore.state.patients.at(-1).id, relationKey: 'son' });
    renderWithProviders(<RelationsSection run={run} />, { route: '/admin' });
    expect(await screen.findByTestId('relation-husband')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('New relation'), 'Nephew');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a relation' }));
    expect(await screen.findByTestId('relation-nephew')).toBeInTheDocument();

    const input = screen.getByLabelText('Relation Nephew');
    fireEvent.change(input, { target: { value: 'Nephew / Niece' } });
    fireEvent.blur(input);
    await waitFor(async () =>
      expect((await family.relations()).find((r) => r.key === 'nephew').label).toBe('Nephew / Niece')
    );

    await userEvent.click(await screen.findByRole('switch', { name: 'Relation Nephew / Niece active' }));
    await waitFor(async () => expect((await family.relations()).map((r) => r.key)).not.toContain('nephew'));
    expect((await family.relations({ includeInactive: true })).map((r) => r.key)).toContain('nephew');

    // In use: the delete is refused ("switch it off instead"), the row stays.
    expect(screen.getByTestId('relation-son')).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: 'Delete relation बेटा (Son)' }));
    await expect(family.admin.remove('son')).rejects.toMatchObject({ response: { status: 409 } });
    expect(screen.getByTestId('relation-son')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete relation Nephew / Niece' }));
    await waitFor(() => expect(screen.queryByTestId('relation-nephew')).toBeNull());

    // Group patients who share a number: preview, then do; a second check finds nothing.
    await patients.create({ name: 'Twin One', phone: '70000 34343' });
    await patients.create({ name: 'Twin Two', phone: '+91 70000-34343' });
    await userEvent.click(screen.getByRole('button', { name: 'Check shared numbers' }));
    const preview = await screen.findByTestId('family-grouping-preview');
    expect(preview).toHaveTextContent('1 patient to link');
    expect(byName('Twin Two').familyOwnerId ?? null).toBeNull();
    await userEvent.click(within(preview).getByRole('button', { name: 'Group them (1)' }));
    expect(await screen.findByTestId('family-grouping-done')).toHaveTextContent('1 patient linked');
    expect(byName('Twin Two')).toMatchObject({ familyOwnerId: byName('Twin One').id, relationKey: null });
    await userEvent.click(screen.getByRole('button', { name: 'Check shared numbers' }));
    expect(await screen.findByTestId('family-grouping-preview')).toHaveTextContent('Nothing to group');
  }, SLOW);
});
