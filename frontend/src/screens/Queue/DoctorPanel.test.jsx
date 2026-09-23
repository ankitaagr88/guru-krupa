import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN, renderWithProviders } from '../../test/utils';
import { appointments, mockStore, prescriptions, treatments, visits } from '../../mocks/adapters';
import { PrescriptionModal } from '../Prescription';
import Queue from './Queue';
import { fmtFollowUp, followUpPresets } from './DoctorPanel';

function renderQueue(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders initialUser={ADMIN}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/queue/:stage" element={<Queue />} />
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

const drawer = () => document.querySelector('#drawer');
const diagnosisId = async (name) => (await treatments.diagnoses()).find((d) => d.name === name).id;

beforeEach(() => {
  mockStore.reset();
  window.print = vi.fn();
});

describe('Doctor panel: diagnosis', () => {
  it('picking a diagnosis saves it on the visit and fills the prescription from the usual set', async () => {
    // Mahesh Desai (3) has no prescription yet; Bharat Oza's Glaucoma prescription is the history.
    await visits.move(3, 'doctor');
    renderQueue('/queue/doctor?patient=3');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const select = await within(drawer()).findByLabelText('Diagnosis');
    expect(within(drawer()).getByText('Nothing prescribed yet')).toBeInTheDocument();
    const glaucoma = await diagnosisId('Glaucoma');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    await userEvent.selectOptions(select, String(glaucoma));

    const note = await within(drawer()).findByTestId('dx-note');
    expect(note).toHaveTextContent('most common past prescription');
    expect(note).toHaveTextContent('Filled 2 medicines');
    // the lines are listed right there in the drawer's prescription section
    expect(drawer()).toHaveTextContent('Timolol 0.5% eye drops');
    expect(within(drawer()).getByRole('button', { name: /Open prescription/ })).toHaveTextContent('2 medicines');
    const rx = await prescriptions.get(3);
    expect(rx.lines.map((l) => l.name)).toContain('Timolol 0.5% eye drops');
    expect(rx.diagnosisId).toBe(glaucoma);
    expect((await visits.get(3)).diagnosisId).toBe(glaucoma);
  });

  it("asks before replacing medicines already written, and says it is Dr Anu's standard", async () => {
    const dry = await diagnosisId('Dry eye');
    await treatments.admin.saveStandard(dry, [{ name: 'Carboxymethylcellulose 0.5% (tear drops)', dosage: '4x daily' }]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderQueue('/queue/doctor?patient=5'); // Bharat Oza: 2 medicines already
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const select = await within(drawer()).findByLabelText('Diagnosis');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    await userEvent.selectOptions(select, String(dry));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith('Replace the 2 medicines with the usual set for Dry eye?')
    );
    expect(await within(drawer()).findByTestId('dx-note')).toHaveTextContent("Dr Anu's standard");
    await waitFor(() => expect(drawer()).toHaveTextContent('Carboxymethylcellulose 0.5% (tear drops)'));
    expect(drawer()).not.toHaveTextContent('Timolol 0.5% eye drops');
    confirm.mockRestore();
  });
});

describe('Doctor panel: follow-up', () => {
  it('a quick button books the appointment, another moves it, "No follow-up" removes it', async () => {
    const [week, twoWeeks, month] = followUpPresets();
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const section = within(drawer().querySelector('#followUpSection'));
    expect(section.getByTestId('fu-status')).toHaveTextContent('No follow-up booked');

    await userEvent.type(section.getByLabelText('Follow-up note'), 'IOP check');
    await userEvent.click(section.getByRole('button', { name: '2 weeks' }));
    await waitFor(() =>
      expect(section.getByTestId('fu-status')).toHaveTextContent(`Appointment booked for ${fmtFollowUp(twoWeeks.date)}`)
    );
    expect(section.getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'true');
    let booked = (await appointments.list({ date: twoWeeks.date })).filter((a) => a.sourceVisitId === 5);
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ name: 'Bharat Oza', patientId: 5, note: 'IOP check', checkedIn: false });
    // the drawer summary shows it
    expect(within(drawer()).getByTestId('summary-follow-up')).toHaveTextContent(`Follow-up: ${fmtFollowUp(twoWeeks.date)}`);

    await userEvent.click(section.getByRole('button', { name: '1 month' }));
    await waitFor(() => expect(section.getByTestId('fu-status')).toHaveTextContent(fmtFollowUp(month.date)));
    expect((await appointments.list({ date: twoWeeks.date })).filter((a) => a.sourceVisitId === 5)).toHaveLength(0);
    booked = (await appointments.list({ date: month.date })).filter((a) => a.sourceVisitId === 5);
    expect(booked.map((a) => a.id)).toHaveLength(1);
    expect(week.date < twoWeeks.date).toBe(true);

    await userEvent.click(section.getByRole('button', { name: 'No follow-up' }));
    await waitFor(() => expect(section.getByTestId('fu-status')).toHaveTextContent('No follow-up booked'));
    expect((await appointments.list()).filter((a) => a.sourceVisitId === 5)).toHaveLength(0);
    expect((await visits.get(5)).followUpDate).toBeNull();
  });

  it('follow-up dates read like "Tue 7 Oct"; a month from 31 Jan is the end of February', () => {
    expect(fmtFollowUp('2026-10-07')).toBe('Wed 7 Oct');
    expect(fmtFollowUp('2026-10-06')).toBe('Tue 6 Oct');
    const [, , m1, m3] = followUpPresets(new Date(2026, 0, 31));
    expect(m1.date).toBe('2026-02-28');
    expect(m3.date).toBe('2026-04-30');
  });
});

describe('Prescription pop-up: save state and next visit', () => {
  it('Save → Saving… → Saved at hh:mm; editing again shows "Unsaved changes"; closing asks first', async () => {
    const onClose = vi.fn();
    renderWithProviders(<PrescriptionModal visit={{ id: 2, name: 'Kiran Vaghela' }} onClose={onClose} />);
    const search = await screen.findByLabelText('Medicine name');
    const save = () => screen.getByRole('button', { name: /^(Save|Saving…|Saved)/ });
    expect(save()).toHaveTextContent('Save');
    expect(save()).toBeDisabled(); // nothing to save yet
    expect(screen.queryByTestId('rx-unsaved')).toBeNull();

    await userEvent.type(search, 'Timolol 0.5% eye drops');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(save()).toHaveTextContent(/^Save$/);
    expect(save()).toBeEnabled();
    expect(screen.getByTestId('rx-unsaved')).toHaveTextContent('Unsaved changes');

    await userEvent.click(save());
    await waitFor(() => expect(save()).toHaveTextContent(/^Saved at \d{1,2}:\d{2}/));
    expect(save()).toBeDisabled();
    expect(screen.queryByTestId('rx-unsaved')).toBeNull();

    await userEvent.type(screen.getByLabelText('Dosage for Timolol 0.5% eye drops'), '1 drop');
    expect(save()).toHaveTextContent(/^Save$/);
    expect(screen.getByTestId('rx-unsaved')).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('preselects the visit diagnosis and prints "Next visit" from the follow-up date', async () => {
    const glaucoma = await diagnosisId('Glaucoma');
    renderWithProviders(
      <PrescriptionModal
        visit={{ id: 5, name: 'Bharat Oza', diagnosisId: glaucoma, followUpDate: '2026-10-07' }}
        onClose={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByLabelText('Diagnosis')).toHaveValue(String(glaucoma)));
    expect(screen.getByRole('img', { name: /Guru Krupa/ })).toHaveAttribute('src', '/logo.png');
    await userEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(await screen.findByTestId('rx-print-next')).toHaveTextContent('Next visit: 7 Oct 2026');
  });

  it('changing the diagnosis in the pop-up updates the visit too', async () => {
    const cataract = await diagnosisId('Cataract');
    const onVisitChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(
      <PrescriptionModal visit={{ id: 5, name: 'Bharat Oza' }} onClose={() => {}} onVisitChange={onVisitChange} />
    );
    const select = await screen.findByLabelText('Diagnosis');
    await userEvent.selectOptions(select, String(cataract));
    await waitFor(() => expect(onVisitChange).toHaveBeenCalledWith(expect.objectContaining({ diagnosisId: cataract })));
    expect((await visits.get(5)).diagnosisName).toBe('Cataract');
    window.confirm.mockRestore();
  });
});
