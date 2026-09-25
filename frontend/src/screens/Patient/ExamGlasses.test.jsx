import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderShell } from '../../test/utils';
import { mockStore, rxPrint } from '../../mocks/adapters';
import { hasUnsavedExamGlasses, markExamGlassesUnsaved } from '../Queue/glasses';
import Patient from './Patient';

describe('Patient screen — examination and glasses', () => {
  beforeEach(() => mockStore.reset());

  it("shows the visit's saved exam findings and glasses prescription", async () => {
    await rxPrint.save(5, {
      exam: [{ key: 'fundus', r: 'Normal', l: 'Cupping 0.6' }],
      glasses: {
        r: { dist: { sph: '-2.75', va: '6/6' }, near: {} },
        l: { dist: { sph: '-4', cyl: '-0.5', axis: '90', va: '6/6' }, near: { va: 'N6' } },
        lensTypes: ['arc'],
        ipd: '66',
      },
    });
    renderShell({
      route: '/patients/5',
      child: (
        <Routes>
          <Route path="/patients/:id" element={<Patient />} />
        </Routes>
      ),
    });
    const block = await screen.findByTestId('patient-exam-glasses');
    expect(within(block).getByText('Fundus')).toBeInTheDocument();
    expect(within(block).getByText(/Cupping 0.6/)).toBeInTheDocument();
    expect(within(block).getByText(/ARC/)).toBeInTheDocument();
    expect(within(block).getByText(/-4.00 -0.50 × 90 VA 6\/6/)).toBeInTheDocument();
    expect(within(block).getByText('IPD 66 mm')).toBeInTheDocument();
  });

  it('keeps track of visits with unsaved exam / glasses edits (Print warns about them)', () => {
    expect(hasUnsavedExamGlasses(7)).toBe(false);
    markExamGlassesUnsaved(7, true);
    expect(hasUnsavedExamGlasses('7')).toBe(true);
    markExamGlassesUnsaved(7, false);
    expect(hasUnsavedExamGlasses(7)).toBe(false);
  });
});
