import { createPortal } from 'react-dom';
import { HOSPITAL_PRINT } from './hospital';

/* Printable prescription sheet. Rendered into <body> via a portal so the
   @media print rules in prescription.css can hide everything else. Takes the
   payload of GET /visits/{id}/prescription/print:
     { hospital:{name,address,phone,doctor}, patient:{name,age,sex,token,date},
       language, lines:[{name,dosage,dosageLocal,qtyGiven}] }
   Each line prints the medicine name in bold and the dosage — nothing else. */
export default function PrescriptionPrint({ payload }) {
  if (!payload || typeof document === 'undefined') return null;
  const h = { ...HOSPITAL_PRINT, ...(payload.hospital || {}) };
  const p = payload.patient || {};
  const lang = payload.language || 'english';
  const date = p.date ? fmtDate(p.date) : fmtDate(new Date().toISOString().slice(0, 10));
  const ageSex = [p.age ? `${p.age} yrs` : null, p.sex || null].filter(Boolean).join(' · ');
  return createPortal(
    <div className="rx-print" data-testid="rx-print" data-lang={lang}>
      <div className="rx-print-head">
        <img className="rx-print-logo" src={h.logo || HOSPITAL_PRINT.logo} alt="" />
        <div className="rx-print-hosp">
          <h1>{h.name}</h1>
          {h.tagline && <div className="rx-print-tag">{h.tagline}</div>}
          <div className="rx-print-addr">{h.address}</div>
          <div className="rx-print-addr">
            Ph: {h.phone} · {h.timings || HOSPITAL_PRINT.timings}
          </div>
        </div>
        <div className="rx-print-doc">
          <b>{h.doctor}</b>
          <span>Ophthalmologist · 15,000+ eye surgeries</span>
        </div>
      </div>
      <div className="rx-print-patient">
        <span>
          <b>{p.name || '—'}</b>
          {ageSex ? ` · ${ageSex}` : ''}
          {p.token ? ` · Token ${p.token}` : ''}
        </span>
        <span>{date}</span>
      </div>
      <div className="rx-print-rx">℞</div>
      <table className="rx-print-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Medicine</th>
            <th>{lang === 'english' ? 'How to use' : 'How to use (' + lang + ')'}</th>
            <th style={{ width: 90 }}>Given</th>
          </tr>
        </thead>
        <tbody>
          {(payload.lines || []).length === 0 && (
            <tr>
              <td colSpan={4} className="rx-print-empty">
                No medicines prescribed
              </td>
            </tr>
          )}
          {(payload.lines || []).map((l, i) => {
            const local = lang !== 'english' && l.dosageLocal && l.dosageLocal !== l.dosage;
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="rx-print-name">
                  <b className="rx-print-brand">{l.name}</b>
                </td>
                <td>
                  <div className="rx-print-dose">
                    <span>{local ? l.dosageLocal : l.dosage || '—'}</span>
                  </div>
                  {local && <div className="rx-print-dose-en">{l.dosage}</div>}
                </td>
                <td>{l.qtyGiven ? `${l.qtyGiven} from clinic` : 'to buy'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="rx-print-foot">
        <div className="rx-print-sign">
          <div className="rx-print-sign-line" />
          {h.doctor}
        </div>
        <div className="rx-print-note">
          24/7 eye emergency care · Cataract · LASIK · Pediatric eye care · Squint
        </div>
      </div>
    </div>,
    document.body
  );
}

function fmtDate(iso) {
  try {
    return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
