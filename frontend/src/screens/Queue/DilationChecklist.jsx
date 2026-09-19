import { fmtTime } from '../../lib/format';
import { dilationComplete } from './queueModel';

/* Dilation checklist inside the drawer (mockup `renderDilationChecklist` / `tickStep`).
   Timers are derived from each step's server `dueAt` (startedAt + minutes) so they
   survive a reload; `now` is the 1 s ticker owned by the Queue screen. */
export default function DilationChecklist({ dilation, now, onGiven, busy = false }) {
  if (!dilation) return null;
  const { steps, currentIndex } = dilation;
  return (
    <div id="dilationChecklist">
      {steps.map((step, i) => {
        if (step.done) {
          return (
            <div className="dstep done" key={i} data-testid={`dstep-${i}`}>
              <span className="dstep-check">✓</span>
              <span className="dstep-name">{step.name}</span>
              <span className="dstep-tag">done</span>
            </div>
          );
        }
        if (i === currentIndex) {
          if (step.given) {
            const remaining = step.dueAt != null ? Math.floor((step.dueAt - now) / 1000) : 0;
            return (
              <div className="dstep active" key={i} data-testid={`dstep-${i}`}>
                <span className="dstep-check">◐</span>
                <span className="dstep-name">
                  {step.name} <small>given, waiting</small>
                </span>
                <span className={`dstep-tag timer${remaining < 0 ? ' overdue' : ''}`}>
                  {fmtTime(remaining)}
                </span>
              </div>
            );
          }
          return (
            <label className="dstep active tickable" key={i} data-testid={`dstep-${i}`}>
              <input type="checkbox" checked={false} disabled={busy} onChange={() => onGiven(i)} />
              <span className="dstep-name">
                {step.name} <small>{step.min} min wait once given</small>
              </span>
            </label>
          );
        }
        const isNext = i === currentIndex + 1;
        return (
          <div className="dstep pending" key={i} data-testid={`dstep-${i}`}>
            <span className="dstep-check">○</span>
            <span className="dstep-name">{step.name}</span>
            {isNext && <span className="dstep-tag next">up next</span>}
          </div>
        );
      })}
      {dilationComplete(dilation) && (
        <div className="dstep-complete">All drops given — ready for the doctor</div>
      )}
    </div>
  );
}
