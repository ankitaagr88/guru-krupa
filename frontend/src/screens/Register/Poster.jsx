import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import QrCode from '../../components/QrCode';
import { HOSPITAL_PRINT } from '../Prescription/hospital';
import { STRINGS } from './strings';
import './poster.css';

export const PAPER = {
  A4: { label: 'A4', page: 'A4 portrait' },
  A5: { label: 'A5', page: 'A5 portrait' },
};

/** The link the QR code opens: this site's own address + /register. */
export function registerUrl() {
  return `${window.location.origin}/register`;
}

/* The front-desk poster: logo, "New patient? Scan to fill your details" in English, Gujarati and
   Hindi, the QR code and the link. Sized in container units, so the on-screen preview and the
   printed A4 / A5 sheet are the same picture at different sizes. */
export function PosterSheet({ url, paper = 'A4', className = '' }) {
  const h = HOSPITAL_PRINT;
  return (
    <div className={`poster-sheet poster-${paper.toLowerCase()} ${className}`} data-testid="intake-poster">
      <div className="poster-inner">
        <img className="poster-logo" src={h.logo} alt={h.name} />
        <p className="poster-hospital">{h.name}</p>
        <div className="poster-lines">
          <p className="poster-line poster-line-main" lang="en">
            {STRINGS.en.posterHeadline}
          </p>
          <p className="poster-line" lang="gu">
            {STRINGS.gu.posterHeadline}
          </p>
          <p className="poster-line" lang="hi">
            {STRINGS.hi.posterHeadline}
          </p>
        </div>
        <div className="poster-qr">
          <QrCode text={url} size="100%" title="Scan to open the new patient form" />
        </div>
        <p className="poster-url">{url}</p>
        <div className="poster-first">
          <p lang="en">{STRINGS.en.posterFirstVisit}</p>
          <p lang="gu">{STRINGS.gu.posterFirstVisit}</p>
          <p lang="hi">{STRINGS.hi.posterFirstVisit}</p>
        </div>
        <p className="poster-foot">
          {h.address} · {h.phone}
        </p>
      </div>
    </div>
  );
}

/* Prints the poster once, the way the receipt prints: rendered into <body>, everything else
   hidden while `printing-poster` is on <body>, page size from the chosen paper. */
export function PosterPrint({ url, paper, onDone }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    document.body.classList.add('printing-poster');
    const t = setTimeout(() => {
      try {
        window.print();
      } finally {
        document.body.classList.remove('printing-poster');
        done.current?.();
      }
    }, 80);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('printing-poster');
    };
  }, []);
  return createPortal(
    <div className="intake-poster-print">
      <style>{`@page { size: ${PAPER[paper]?.page || 'A4 portrait'}; margin: 0; }`}</style>
      <PosterSheet url={url} paper={paper} />
    </div>,
    document.body
  );
}
