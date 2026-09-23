import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { PAPER, PosterPrint, PosterSheet, registerUrl } from '../Register/Poster';

/* Admin › New patient form (lane D owns this file): the link to the public self-fill page and a
   printable QR poster for the front desk. The link is this site's own address, so it is only as
   reachable as the app itself: on the clinic PC, only phones on the same Wi-Fi can open it. */
export function IntakeSection() {
  const toast = useToast();
  const [paper, setPaper] = useState('A4');
  const [printing, setPrinting] = useState(false);
  const url = registerUrl();
  const host = window.location.hostname;
  const localOnly = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', url, 2000);
    } catch {
      toast.info('Copy the link by hand', url);
    }
  };

  return (
    <section className="admin-block intake-admin" aria-labelledby="h-intake">
      <h2 id="h-intake">New patient form (QR poster)</h2>
      <p className="hint">
        New patients scan the QR code at the front desk and fill in their own details, in English, Gujarati or
        Hindi. They join today&apos;s queue at the first stage with a note to check their details, and see their
        token number. Staff can open the same form from the queue for patients who need help.
      </p>
      <div className="intake-link">
        <code data-testid="intake-url">{url}</code>
        <button type="button" className="btn-ghost" onClick={copy}>
          Copy link
        </button>
        <a className="btn-ghost" href="/register" target="_blank" rel="noopener">
          Open the form
        </a>
      </div>
      {localOnly ? (
        <p className="intake-warn" role="note">
          This address ({host}) only works on this computer. Open the app by the computer&apos;s network
          address before printing, so phones on the clinic Wi-Fi can reach it.
        </p>
      ) : (
        <p className="hint">
          Phones reach this link only if they can reach this app: on the clinic computer that means the same
          Wi-Fi; once the app is on the rented server, from anywhere.
        </p>
      )}
      <div className="intake-controls">
        <span className="intake-controls-label">Paper</span>
        <div className="sex-toggle" role="group" aria-label="Paper size">
          {Object.keys(PAPER).map((k) => (
            <button key={k} type="button" className={paper === k ? 'active' : ''} onClick={() => setPaper(k)}>
              {PAPER[k].label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary" onClick={() => setPrinting(true)} disabled={printing}>
          Print poster
        </button>
      </div>
      <div className="intake-preview">
        <PosterSheet url={url} paper={paper} />
      </div>
      {printing && <PosterPrint url={url} paper={paper} onDone={() => setPrinting(false)} />}
    </section>
  );
}
