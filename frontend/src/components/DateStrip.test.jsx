import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateStrip, { fmtDateLabel, stripDates } from './DateStrip';
import { dateStr } from '../mocks/data';

describe('DateStrip', () => {
  it('renders yesterday through +6 days with Today/Tmrw labels and counts', () => {
    const today = dateStr(0);
    const counts = { [today]: 3, [dateStr(1)]: 2 };
    render(<DateStrip value={today} onChange={() => {}} counts={counts} />);
    const pills = screen.getAllByRole('tab');
    expect(pills).toHaveLength(8);
    expect(pills[1]).toHaveTextContent('Today');
    expect(pills[1]).toHaveClass('active');
    expect(pills[1].querySelector('.dcount')).toHaveTextContent('3');
    expect(pills[2]).toHaveTextContent('Tmrw');
    expect(pills[2].querySelector('.dcount')).toHaveTextContent('2');
    expect(pills[0]).not.toHaveClass('active');
    expect(pills[0].querySelector('.dcount')).toBeNull();
  });

  it('calls onChange with the ISO date when a day is clicked and reflects the new selection', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<DateStrip value={dateStr(0)} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole('tab')[3]);
    expect(onChange).toHaveBeenCalledWith(dateStr(2));
    rerender(<DateStrip value={dateStr(2)} onChange={onChange} />);
    expect(screen.getAllByRole('tab')[3]).toHaveClass('active');
    expect(screen.getAllByRole('tab')[1]).not.toHaveClass('active');
  });

  it('fmtDateLabel produces heading text', () => {
    expect(fmtDateLabel(dateStr(0), true)).toMatch(/^Today /);
    expect(fmtDateLabel(dateStr(1), true)).toMatch(/^Tomorrow /);
    expect(stripDates()).toHaveLength(8);
  });
});
