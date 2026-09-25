import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { rxPrint } from '../../api';
import { mockStore } from '../../mocks/adapters';
import { RxPrintAdminSections } from './RxPrintAdmin';

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

describe('Admin › prescription print, exam findings, lens types', () => {
  beforeEach(() => mockStore.reset());

  it('prescription print: degrees, Reg. No. and footer notes save, and the preview follows', async () => {
    renderWithProviders(<RxPrintAdminSections run={run} />);
    expect(await screen.findByRole('heading', { name: 'Prescription print' })).toBeInTheDocument();
    const s = section('h-rxprint');
    await waitFor(() => expect(s.getByLabelText("Doctor's name")).toHaveValue('Dr. Anu Juneja Pathak'));
    await userEvent.clear(s.getByLabelText('Degrees'));
    await userEvent.type(s.getByLabelText('Degrees'), 'M.B.B.S., M.S. (Ophth.)');
    await userEvent.type(s.getByLabelText('Registration number'), 'G-12345');
    const preview = s.getByTestId('rxp-preview');
    expect(preview).toHaveTextContent('Reg. No. G-12345');
    await userEvent.click(within(preview).getByRole('button', { name: 'Gujarati' }));
    expect(preview).toHaveTextContent('ફરી બતાવવા આવો');
    await userEvent.clear(s.getByLabelText('Footer note hindi'));
    await userEvent.click(within(preview).getByRole('button', { name: 'Hindi' }));
    expect(preview).toHaveTextContent('Please bring your medicines'); // empty Hindi → the English note

    await userEvent.click(s.getByRole('button', { name: 'Save print settings' }));
    await waitFor(async () => expect((await rxPrint.settings()).regNo).toBe('G-12345'));
    const saved = await rxPrint.settings();
    expect(saved.degrees).toBe('M.B.B.S., M.S. (Ophth.)');
    expect(saved.footerNote.hindi).toBe('');
  });

  it('exam findings: add with a default, rename, change the default, reorder, switch off', async () => {
    renderWithProviders(<RxPrintAdminSections run={run} />);
    const s = section('h-exam');
    await waitFor(() => expect(s.getByLabelText('Finding Fundus')).toBeInTheDocument());

    await userEvent.type(s.getByLabelText('New finding'), 'Cornea');
    await userEvent.type(s.getByLabelText('Default for the new finding'), 'Clear');
    await userEvent.click(s.getByRole('button', { name: '+ Add' }));
    await waitFor(() => expect(s.getByLabelText('Finding Cornea')).toBeInTheDocument());
    expect(s.getByLabelText('Default for Cornea')).toHaveValue('Clear');

    const name = s.getByLabelText('Finding Cornea');
    fireEvent.change(name, { target: { value: 'Cornea & conjunctiva' } });
    fireEvent.blur(name);
    await waitFor(() => expect(s.getByLabelText('Finding Cornea & conjunctiva')).toBeInTheDocument());
    const def = s.getByLabelText('Default for Lens');
    fireEvent.change(def, { target: { value: 'Clear, no cataract' } });
    fireEvent.blur(def);
    await waitFor(async () =>
      expect((await rxPrint.lists()).examFindings.find((f) => f.key === 'lens').defaultValue).toBe(
        'Clear, no cataract'
      )
    );

    await userEvent.click(s.getByLabelText('Move Finding Cornea & conjunctiva up'));
    await waitFor(async () => {
      const keys = (await rxPrint.admin.examFindings()).map((f) => f.key);
      expect(keys.indexOf('cornea')).toBe(keys.indexOf('fundus') - 1);
    });

    await userEvent.click(s.getByRole('switch', { name: 'Finding Pupil active' }));
    await waitFor(async () =>
      expect((await rxPrint.lists()).examFindings.map((f) => f.key)).not.toContain('pupil')
    );
    expect((await rxPrint.admin.examFindings()).map((f) => f.key)).toContain('pupil'); // kept, just off
  });

  it('lens types: add, reorder and switch off', async () => {
    renderWithProviders(<RxPrintAdminSections run={run} />);
    const s = section('h-lenstypes');
    await waitFor(() => expect(s.getByLabelText('Lens type ARC')).toBeInTheDocument());
    await userEvent.type(s.getByLabelText('New lens type'), 'Anti-glare');
    await userEvent.click(s.getByRole('button', { name: '+ Add' }));
    await waitFor(() => expect(s.getByLabelText('Lens type Anti-glare')).toBeInTheDocument());
    await userEvent.click(s.getByLabelText('Move Lens type Blue cut up'));
    await waitFor(async () =>
      expect((await rxPrint.lists()).lensTypes.map((t) => t.key).slice(0, 2)).toEqual(['blue_cut', 'arc'])
    );
    await userEvent.click(s.getByRole('switch', { name: 'Lens type Bifocal active' }));
    await waitFor(async () =>
      expect((await rxPrint.lists()).lensTypes.map((t) => t.key)).not.toContain('bifocal')
    );
    expect((await rxPrint.lists()).lensTypes.map((t) => t.label)).toContain('Anti-glare');
  });
});
