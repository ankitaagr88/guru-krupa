import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { rxPrint } from '../../api';
import { mockStore } from '../../mocks/adapters';
import { PrescriptionModal } from './index';
import PrescriptionPrint from './PrescriptionPrint';

/* The printed sheet (lane R): Examination and Glass details blocks, patient ID / area, the doctor's
   degrees + Reg. No. and the footer note — each only when there is something to print. */

const GLASSES = {
  r: { dist: { sph: '-2.75', va: '6/6' }, near: { va: 'N6' } },
  l: { dist: { sph: '-4', va: '6/6' }, near: { va: 'N6' } },
  lensTypes: ['arc'],
  ipd: '66',
};

async function printFor(visit, language) {
  renderWithProviders(<PrescriptionModal visit={visit} onClose={() => {}} />);
  await screen.findByText('Print language');
  if (language) await userEvent.click(screen.getByRole('button', { name: language }));
  await userEvent.click(screen.getByRole('button', { name: 'Print' }));
  return screen.findByTestId('rx-print');
}

describe('Printed prescription: exam, glasses, degrees, footer', () => {
  beforeEach(() => {
    mockStore.reset();
    window.print = vi.fn();
  });

  it('prints Examination, Glass details (ARC, IPD), Reg. No. and the Gujarati footer when filled in', async () => {
    await rxPrint.save(5, { exam: [{ key: 'fundus', r: 'Normal', l: 'Normal' }], glasses: GLASSES });
    const settings = await rxPrint.settings();
    await rxPrint.admin.saveSettings({ ...settings, degrees: 'M.B.B.S., M.S. (Ophth.)', regNo: 'G-12345' });

    const sheet = await printFor({ id: 5, name: 'Bharat Oza' }, 'Gujlish');
    const patient = within(sheet).getByTestId('rx-print-patient');
    expect(patient).toHaveTextContent('ID 5');
    expect(patient).toHaveTextContent('Bharat Oza · 71 yrs / M · Ghod Dod Road, Surat');

    const exam = within(sheet).getByTestId('rx-print-exam');
    expect(exam).toHaveTextContent('Examination');
    const fundus = within(exam).getByRole('rowheader', { name: 'Fundus' }).closest('tr');
    expect(within(fundus).getAllByText('Normal')).toHaveLength(2);
    expect(within(exam).queryByText('Pupil')).toBeNull(); // only filled rows

    const glasses = within(sheet).getByTestId('rx-print-glasses');
    expect(glasses).toHaveTextContent('Glass details: ARC');
    const dist = within(glasses).getByRole('rowheader', { name: 'Dist' }).closest('tr');
    expect(dist).toHaveTextContent('-2.75');
    expect(dist).toHaveTextContent('-4.00'); // tidied when saved
    expect(within(glasses).getByRole('rowheader', { name: 'Near' }).closest('tr')).toHaveTextContent('N6');
    expect(glasses).toHaveTextContent('IPD: 66 mm');

    expect(within(sheet).getByTestId('rx-print-doc')).toHaveTextContent('M.B.B.S., M.S. (Ophth.)');
    expect(within(sheet).getByTestId('rx-print-doc')).toHaveTextContent('Reg. No. G-12345');
    expect(within(sheet).getByTestId('rx-print-sign')).toHaveTextContent('Reg. No. G-12345');
    expect(within(sheet).getByTestId('rx-print-footnote')).toHaveTextContent(
      'ફરી બતાવવા આવો ત્યારે દવા સાથે લાવવી.'
    );
    // the medicines are still there, after the glasses
    expect(sheet.querySelector('.rx-print-table')).not.toBeNull();
    expect(sheet.innerHTML.indexOf('rx-print-glasses')).toBeLessThan(
      sheet.innerHTML.indexOf('rx-print-table')
    );
  });

  it('a sheet with only medicines has no exam or glasses tables and no Reg. No. line; English footer', async () => {
    const sheet = await printFor({ id: 5, name: 'Bharat Oza' });
    expect(within(sheet).queryByTestId('rx-print-exam')).toBeNull();
    expect(within(sheet).queryByTestId('rx-print-glasses')).toBeNull();
    expect(within(sheet).getByTestId('rx-print-doc')).not.toHaveTextContent('Reg. No.');
    expect(within(sheet).getByTestId('rx-print-footnote')).toHaveTextContent(
      'Please bring your medicines when you come for the next visit.'
    );
    expect(sheet.querySelector('.rx-print-table')).not.toBeNull();
  });

  it('a glasses-only sheet prints no empty medicines table', async () => {
    await rxPrint.save(3, { exam: [], glasses: { r: { dist: { sph: '+1.5' } } } });
    const sheet = await printFor({ id: 3, name: 'Mahesh Desai' });
    expect(within(sheet).getByTestId('rx-print-glasses')).toHaveTextContent('+1.50');
    expect(within(sheet).queryByTestId('rx-print-glasses')).not.toHaveTextContent('Near');
    expect(sheet.querySelector('.rx-print-table')).toBeNull();
    expect(within(sheet).queryByText('No medicines prescribed')).toBeNull();
  });

  it('falls back to the English footer when the sheet language has none', async () => {
    const settings = await rxPrint.settings();
    await rxPrint.admin.saveSettings({ ...settings, footerNote: { ...settings.footerNote, hindi: '' } });
    const sheet = await printFor({ id: 5, name: 'Bharat Oza' }, 'Hinglish');
    expect(within(sheet).getByTestId('rx-print-footnote')).toHaveTextContent('Please bring your medicines');
  });

  it('prints the KiviHealth patient ID when there is one, and no footer line when none is set', () => {
    render(
      <PrescriptionPrint
        payload={{
          patient: { name: 'X', patientId: 'GK1234', area: '' },
          language: 'hinglish',
          lines: [],
          exam: [],
          glasses: null,
          doctor: { name: 'Dr. A', degrees: '', regNo: '' },
          footerNote: '',
        }}
      />
    );
    const sheet = screen.getByTestId('rx-print');
    expect(within(sheet).getByTestId('rx-print-patient')).toHaveTextContent('ID GK1234 · X');
    expect(within(sheet).queryByTestId('rx-print-footnote')).toBeNull();
  });
});
