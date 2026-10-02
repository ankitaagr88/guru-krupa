import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import Admin from './Admin';

const csvFile = (lines, name) => new File([lines.join('\n')], name, { type: 'text/csv' });

const openImport = async () => {
  window.confirm = () => true;
  renderShell({ route: '/admin', child: <Admin /> });
  await screen.findByRole('heading', { name: 'Import from KiviHealth' });
};

describe('Import (several files, past visits, past bills)', () => {
  it('shows the order and the several-files hint; lists the new kinds of file', async () => {
    await openImport();
    expect(screen.getByText(/Order: Patients → Medicines → Past visits → Past bills → Prescriptions\./)).toBeInTheDocument();
    expect(screen.getByText(/Pick several files with the same columns/)).toBeInTheDocument();
    expect(screen.getByTestId('import-file-input')).toHaveAttribute('multiple');
  });

  it('reads several same-column files as one and imports them together', async () => {
    await openImport();
    const head = 'Local Id,First Name,Last Name,Contact,Pincode';
    const a = csvFile([head, 'GK7001,Meena,Shah,9800000001,395007'], '2021-Patients.csv');
    const b = csvFile([head, 'GK7002,Ravi,Desai,9800000002,395009', 'GK7003,Nita,Joshi,9800000003,'], '2022-Patients.csv');
    fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [a, b] } });
    const note = await screen.findByTestId('import-file-note', {}, { timeout: 4000 });
    expect(note).toHaveTextContent('2 files (2021-Patients.csv, 2022-Patients.csv)');
    expect(note).toHaveTextContent('3 rows');
    expect(screen.getByLabelText('Column for First name')).toHaveValue('First Name');
    expect(screen.queryByTestId('import-missing')).toBeNull();

    await userEvent.click(screen.getByTestId('import-preview'));
    expect(await screen.findByTestId('import-result', {}, { timeout: 4000 })).toHaveTextContent('3 new');
    await userEvent.click(screen.getByTestId('import-run'));
    expect(await screen.findByTestId('import-done', {}, { timeout: 4000 })).toHaveTextContent('3 added');
    const api = await import('../../api');
    const meena = (await api.patients.list()).find((p) => p.name === 'Meena Shah');
    expect(meena).toBeTruthy();
  });

  it('refuses files whose columns differ', async () => {
    await openImport();
    const a = csvFile(['Name,Contact', 'X,1'], 'a.csv');
    const b = csvFile(['Name,Gender', 'Y,M'], 'b.csv');
    fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [a, b] } });
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('b.csv has different columns from a.csv');
  });

  it('imports past visits and past bills with their notes', async () => {
    await openImport();
    const visits = csvFile(
      ['Patient Name,Appointment Date,Reason', 'Rasilaben Patel,12/03/2022,Eye check', 'Nobody Known,13/03/2022,'],
      'appointments.csv',
    );
    fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [visits] } });
    await screen.findByTestId('import-file-note', {}, { timeout: 4000 });
    await userEvent.click(screen.getByRole('radio', { name: 'Past visits' }));
    await userEvent.click(screen.getByTestId('import-preview'));
    const pv = await screen.findByTestId('import-result', {}, { timeout: 4000 });
    expect(pv).toHaveTextContent('1 new');
    expect(pv).toHaveTextContent('patient not found');
    await userEvent.click(screen.getByTestId('import-run'));
    expect(await screen.findByTestId('import-done', {}, { timeout: 4000 })).toHaveTextContent("show on each patient's page as visits from the previous system");

    await userEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    const bills = csvFile(
      ['Patient Name,Date,Treatment Plan,Amount,Payment Mode,Receipt Number', 'Rasilaben Patel,12/03/2022,Consultation,300,Cash,R1', 'Rasilaben Patel,12/03/2022,Drops,abc,Cash,R1'],
      'payments.csv',
    );
    fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [bills] } });
    await screen.findByTestId('import-file-note', {}, { timeout: 4000 });
    await userEvent.click(screen.getByRole('radio', { name: 'Past bills' }));
    await userEvent.click(screen.getByTestId('import-preview'));
    const pb = await screen.findByTestId('import-result', {}, { timeout: 4000 });
    expect(pb).toHaveTextContent('1 new');
    expect(pb).toHaveTextContent('1 skipped');
    await userEvent.click(screen.getByTestId('import-run'));
    expect(await screen.findByTestId('import-done', {}, { timeout: 4000 })).toHaveTextContent('not counted in the Day book or Today');
  });
});
