import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast, TOAST_MS } from './Toast';

let api;
function Grab() {
  api = useToast();
  return null;
}
const renderToasts = () =>
  render(
    <ToastProvider>
      <Grab />
    </ToastProvider>
  );

afterEach(() => vi.useRealTimers());

describe('Toasts', () => {
  it('ordinary toasts go away on their own; errors stay a little longer', () => {
    vi.useFakeTimers();
    renderToasts();
    act(() => {
      api.push({ title: 'Plain note', variant: 'info' });
      api.error('Could not save', 'Network');
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(2);
    act(() => vi.advanceTimersByTime(TOAST_MS + 10));
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByText('Could not save')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryAllByTestId('toast')).toHaveLength(0);
  });

  it('the dilation toast stays until acted on; its buttons run and close it', () => {
    vi.useFakeTimers();
    renderToasts();
    const send = vi.fn();
    const open = vi.fn();
    act(() => {
      api.dilationDue({ id: 7, name: 'Ilaben Chauhan', token: '#005' }, 'All drops given.', [
        { label: 'Send to doctor', onClick: send, primary: true },
        { label: 'Open', onClick: open },
      ]);
    });
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByText('Dilation wait is up')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send to doctor' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText('Dilation wait is up')).toBeNull();
  });
});
