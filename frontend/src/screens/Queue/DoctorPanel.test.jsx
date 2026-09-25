import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import AppShell from '../../components/AppShell';
import { ADMIN, renderWithProviders } from '../../test/utils';
import { appointments, mockStore, prescriptions, rxPrint, treatments, visits } from '../../mocks/adapters';
import { PrescriptionModal } from '../Prescription';
import Queue from './Queue';
import { fmtFollowUp, followUpPresets } from './DoctorPanel';
import { hasUnsavedExamGlasses } from './glasses';

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
    expect(within(drawer()).getByRole('button', { name: 'Write prescription' })).toBeInTheDocument();
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
    // "No follow-up" is an ordinary choice: picked while nothing is booked, not once a date is
    expect(section.getByRole('button', { name: 'No follow-up' })).toHaveAttribute('aria-pressed', 'false');
    expect(section.getByRole('button', { name: 'No follow-up' })).toBeEnabled();

    await userEvent.click(section.getByRole('button', { name: '1 month' }));
    await waitFor(() => expect(section.getByTestId('fu-status')).toHaveTextContent(fmtFollowUp(month.date)));
    expect((await appointments.list({ date: twoWeeks.date })).filter((a) => a.sourceVisitId === 5)).toHaveLength(0);
    booked = (await appointments.list({ date: month.date })).filter((a) => a.sourceVisitId === 5);
    expect(booked.map((a) => a.id)).toHaveLength(1);
    expect(week.date < twoWeeks.date).toBe(true);

    await userEvent.click(section.getByRole('button', { name: 'No follow-up' }));
    await waitFor(() => expect(section.getByTestId('fu-status')).toHaveTextContent('No follow-up booked'));
    expect(section.getByRole('button', { name: 'No follow-up' })).toHaveAttribute('aria-pressed', 'true');
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

describe('Doctor panel: examination and glasses (printed on the prescription)', () => {
  const exam = () => within(drawer().querySelector('#examSection'));
  const glasses = () => within(drawer().querySelector('#glassesSection'));
  const SAVED = { timeout: 4000 };

  it('saves on its own: IOP pre-filled from the tonometer, "Normal for all", tidied powers; a bad value stays red and is not sent', async () => {
    renderQueue('/queue/doctor?patient=5'); // Bharat Oza: tonometer IOP 24 / 26
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await waitFor(() => expect(exam().getByLabelText('Fundus R')).toBeEnabled());
    // no save button any more — it saves like the rest of the drawer
    expect(within(drawer()).queryByRole('button', { name: /Save exam/ })).toBeNull();
    // IOP comes from the approved tonometer reading and is saved straight away
    expect(exam().getByLabelText('IOP (mmHg) R')).toHaveValue('24');
    expect(exam().getByLabelText('IOP (mmHg) L')).toHaveValue('26');
    expect(exam().getByTestId('eg-prefilled')).toHaveTextContent('IOP from HNT-1P');
    await waitFor(async () => expect((await rxPrint.get(5)).exam.find((r) => r.key === 'iop')).toMatchObject({ r: '24', l: '26' }), SAVED);

    await userEvent.click(exam().getByRole('button', { name: 'Normal for all' }));
    expect(exam().getByLabelText('Fundus R')).toHaveValue('Normal');
    expect(exam().getByLabelText('Lens L')).toHaveValue('Clear');
    await userEvent.clear(exam().getByLabelText('Pupil L'));
    await userEvent.click(exam().getByRole('button', { name: 'Pupil: Normal both eyes' }));
    expect(exam().getByLabelText('Pupil L')).toHaveValue('Normal');

    const sph = glasses().getByLabelText('R Dist Sph');
    await userEvent.type(sph, '-2.5');
    fireEvent.blur(sph);
    expect(sph).toHaveValue('-2.50');
    const cyl = glasses().getByLabelText('L Dist Cyl');
    await userEvent.type(cyl, '-0.3');
    fireEvent.blur(cyl);
    expect(cyl).toHaveAttribute('aria-invalid', 'true');
    expect(glasses().getByRole('alert')).toHaveTextContent('not a quarter step');
    await userEvent.type(glasses().getByLabelText('R Near VA'), 'N6');
    await userEvent.click(glasses().getByRole('button', { name: 'ARC' }));
    expect(glasses().getByRole('button', { name: 'ARC' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(glasses().getByLabelText('IPD (mm)'), '66');

    // everything else is saved; the red cylinder is held back and the status says why
    await waitFor(async () => expect((await rxPrint.get(5)).glasses?.ipd).toBe('66'), SAVED);
    let saved = await rxPrint.get(5);
    expect(saved.glasses.r.dist.sph).toBe('-2.50');
    expect(saved.glasses.l.dist.cyl).toBe('');
    expect(saved.glasses.lensTypes).toEqual(['arc']);
    await waitFor(() => expect(glasses().getByTestId('eg-status-glasses')).toHaveTextContent('Fix the red box to save it'));

    await userEvent.clear(cyl);
    await userEvent.type(cyl, '-.5');
    fireEvent.blur(cyl);
    expect(cyl).toHaveValue('-0.50');
    await userEvent.type(glasses().getByLabelText('L Dist Axis'), '90');
    fireEvent.blur(glasses().getByLabelText('L Dist Axis'));
    await waitFor(() => expect(glasses().getByTestId('eg-status-glasses')).toHaveTextContent(/^Saved at \d{1,2}:\d{2}/), SAVED);
    saved = await rxPrint.get(5);
    expect(saved.exam.map((r) => r.key)).toEqual(['lids', 'anterior', 'pupil', 'lens', 'iop', 'fundus']);
    expect(saved.glasses.l.dist).toMatchObject({ cyl: '-0.50', axis: '90' });
    expect(saved.glasses.r.near.va).toBe('N6');
  });

  it('Print warns while a change is pending; closing the drawer sends it', async () => {
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    await waitFor(() => expect(exam().getByLabelText('Fundus R')).toBeEnabled());
    await waitFor(() => expect(hasUnsavedExamGlasses(5)).toBe(false), SAVED); // the IOP pre-fill went out
    await userEvent.clear(exam().getByLabelText('Fundus R'));
    await userEvent.type(exam().getByLabelText('Fundus R'), 'Cup 0.6');
    expect(hasUnsavedExamGlasses(5)).toBe(true);
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Close' }));
    await waitFor(async () => expect((await rxPrint.get(5)).exam.find((r) => r.key === 'fundus')?.r).toBe('Cup 0.6'), SAVED);
    expect(hasUnsavedExamGlasses(5)).toBe(false);
  });

  it('"Fill from machine reading" copies the refraction Sph / Cyl / Axis, PD and the chart VA, then saves', async () => {
    await visits.move(4, 'doctor'); // Falguni Shah: HRK-8000A refraction on file, VA 6/9 · 6/6
    renderQueue('/queue/doctor?patient=4');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const fill = await glasses().findByRole('button', { name: 'Fill from machine reading' });
    await waitFor(() => expect(fill).toBeEnabled());
    await userEvent.click(fill);
    expect(glasses().getByLabelText('R Dist Sph')).toHaveValue('-1.00');
    expect(glasses().getByLabelText('R Dist Cyl')).toHaveValue('-0.50');
    expect(glasses().getByLabelText('R Dist Axis')).toHaveValue('90');
    expect(glasses().getByLabelText('L Dist Sph')).toHaveValue('-0.75');
    expect(glasses().getByLabelText('L Dist Axis')).toHaveValue('85');
    expect(glasses().getByLabelText('R Dist VA')).toHaveValue('6/9');
    expect(glasses().getByLabelText('L Dist VA')).toHaveValue('6/6');
    expect(glasses().getByLabelText('IPD (mm)')).toHaveValue('64');
    expect(drawer()).toHaveTextContent('Filled from HRK-8000A — Refraction (REF)');
    await waitFor(async () => expect((await rxPrint.get(4)).glasses?.r.dist.sph).toBe('-1.00'), SAVED);
  });

  it('works for the demo glaucoma patient too (Bharat Oza has a refraction reading)', async () => {
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const fill = await glasses().findByRole('button', { name: 'Fill from machine reading' });
    await waitFor(() => expect(fill).toBeEnabled());
    await userEvent.click(fill);
    expect(glasses().getByLabelText('R Dist Sph')).toHaveValue('+1.50');
    expect(glasses().getByLabelText('L Dist Axis')).toHaveValue('80');
    expect(glasses().getByLabelText('IPD (mm)')).toHaveValue('63');
  });

  it('with no approved refraction reading the fill button is off and says why', async () => {
    await visits.move(3, 'doctor'); // Mahesh Desai: no readings
    renderQueue('/queue/doctor?patient=3');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    expect(await glasses().findByText('No refraction reading yet')).toBeInTheDocument();
    expect(glasses().getByRole('button', { name: 'Fill from machine reading' })).toBeDisabled();
    expect(exam().getByLabelText('IOP (mmHg) R')).toHaveValue(''); // nothing to pre-fill
  });
});

describe('Doctor stage layout', () => {
  it('readings first, exam photos only when there are some, and the stage buttons in the footer', async () => {
    renderQueue('/queue/doctor?patient=5');
    await waitFor(() => expect(drawer()).toHaveClass('show'));
    const order = [...drawer().querySelectorAll('.doc-grid section')].map((s) => s.className);
    expect(order[0]).toBe('doc-o1');
    expect(within(drawer().querySelector('#doctorReadings')).getByText(/HNT-1P/)).toBeInTheDocument();
    expect(within(drawer()).queryByText('Exam photos')).toBeNull();
    expect(within(drawer()).getByTestId('add-exam-photo')).toHaveAttribute('href', '/machines?visit=5');
    // no visit-type chips with the doctor — only the small "Different problem" link
    expect(within(drawer()).queryByTestId('visit-kind-panel')).toBeNull();
    const foot = drawer().querySelector('.drawer-foot');
    expect(within(foot).getByRole('button', { name: 'Send to billing' })).toBeInTheDocument();
    expect(within(foot).getByRole('button', { name: 'Start dilation drops' })).toBeInTheDocument();
    // the patient's name is plain text; the record is a separate link in the header
    expect(within(drawer().querySelector('.drawer-head')).getByTestId('drawer-record-link')).toHaveAttribute(
      'href',
      '/patients/5'
    );
  });
});
