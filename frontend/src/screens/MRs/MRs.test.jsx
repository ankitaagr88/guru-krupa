import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderShell } from '../../test/utils';
import { mr } from '../../api';
import MRs, { dueStatus, fmtVisitDate } from './MRs';

const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

describe('MR visits', () => {
  it('due indicator and date formatting', () => {
    expect(dueStatus(iso(-2)).cls).toBe('coral');
    expect(dueStatus(iso(0))).toEqual({ cls: 'coral', text: 'Due today' });
    expect(dueStatus(iso(5)).cls).toBe('amber');
    expect(dueStatus(iso(20)).cls).toBe('plain');
    expect(dueStatus('in ~2 weeks')).toEqual({ cls: 'plain', text: 'in ~2 weeks' });
    expect(dueStatus('')).toEqual({ cls: '', text: 'not set' });
    expect(fmtVisitDate(iso(0))).toBe('Today');
    expect(fmtVisitDate(iso(-3))).toBe('3 days ago');
    expect(fmtVisitDate('6 weeks ago')).toBe('6 weeks ago');
  });

  it('lists visits, filters, logs a new one (newest first) and groups history per rep', async () => {
    renderShell({ route: '/mrs', child: <MRs /> });
    expect((await screen.findAllByText('Rajesh Kumar')).length).toBe(2);
    expect(screen.getByText('Anita Desai')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Filter visits'), 'cipla');
    expect(screen.queryByText('Rajesh Kumar')).toBeNull();
    await userEvent.clear(screen.getByLabelText('Filter visits'));

    await userEvent.click(screen.getByRole('button', { name: '+ Log MR visit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Rep name'), 'Rajesh Kumar');
    // company auto-filled from the known rep
    expect(within(dialog).getByLabelText('Company')).toHaveValue('Sun Pharma');
    await userEvent.type(within(dialog).getByLabelText('Products discussed'), 'Ketorolac, Moxifloxacin');
    fireEvent.change(within(dialog).getByLabelText('Next visit date'), { target: { value: iso(3) } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save visit' }));

    await waitFor(() => expect(screen.getAllByText('Rajesh Kumar').length).toBe(3));
    const firstRow = document.querySelector('#mrList tr');
    expect(within(firstRow).getByText('Today')).toBeInTheDocument();
    expect(within(firstRow).getByText(/Due in 3 days/)).toBeInTheDocument();

    const reps = await mr.reps();
    const rajesh = reps.find((r) => r.repName === 'Rajesh Kumar');
    expect(rajesh.visits).toBe(3);
    expect(rajesh.nextVisitDate).toBe(iso(3));

    await userEvent.click(within(firstRow).getByText('Rajesh Kumar'));
    const detail = await screen.findByRole('dialog');
    expect(await within(detail).findByText('Visit history (3)')).toBeInTheDocument();
    expect(within(detail).getByText('Ketorolac')).toBeInTheDocument();
    expect(within(detail).getByText('Carboxymethylcellulose (tear drops)')).toBeInTheDocument();
    expect(within(detail).getByText('Sun Pharma · 98240 11111')).toBeInTheDocument();
  });
});
