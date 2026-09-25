import { createPortal } from 'react-dom';
import { HOSPITAL_PRINT } from './hospital';

/* Printable prescription sheet. Rendered into <body> via a portal so the
   @media print rules in prescription.css can hide everything else. Takes the
   payload of GET /visits/{id}/prescription/print:
     { hospital:{name,address,phone,doctor},
       patient:{name,age,sex,token,date,patientId,area},
       language, lines:[{name,dosage,dosageLocal,qtyGiven}],
       exam:[{label,r,l}], glasses:{rows:[{key,label,r:{sph,cyl,axis,va},l:{…}}], lensTypes, ipd, note}|null,
       doctor:{name,degrees,regNo}, footerNote }
   Printed in this order, each block only when it has something in it:
     header (doctor's degrees + Reg. No.) · patient line (ID · name · age/sex · area · date) ·
     Examination · Glass details (+ lens types, IPD) · ℞ medicines · next visit · footer note ·
     signature (degrees + Reg. No.).
   `followUpDate` ('YYYY-MM-DD', from the visit; or payload.patient.followUpDate) prints as
   "Next visit: 7 Oct 2026" under the medicines. */
export default function PrescriptionPrint({ payload, followUpDate }) {
  if (!payload || typeof document === 'undefined') return null;
  const h = { ...HOSPITAL_PRINT, ...(payload.hospital || {}) };
  const p = payload.patient || {};
  const doc = payload.doctor || { name: h.doctor, degrees: '', regNo: '' };
  const docName = doc.name || h.doctor;
  const regNo = (doc.regNo || '').trim();
  const nextVisit = followUpDate || p.followUpDate || null;
  const lang = payload.language || 'english';
  const date = p.date ? fmtDate(p.date) : fmtDate(new Date().toISOString().slice(0, 10));
  const ageSex = [p.age ? `${p.age} yrs` : null, p.sex || null].filter(Boolean).join(' / ');
  const lines = payload.lines || [];
  const exam = (payload.exam || []).filter((r) => r.r || r.l);
  const glasses = payload.glasses || null; // null when the visit has no glasses prescription
  const footer = (payload.footerNote || '').trim();
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
        <div className="rx-print-doc" data-testid="rx-print-doc">
          <b>{docName}</b>
          {doc.degrees && <span>{doc.degrees}</span>}
          {regNo && <span className="rx-print-reg">Reg. No. {regNo}</span>}
          <span>Ophthalmologist · 15,000+ eye surgeries</span>
        </div>
      </div>
      <div className="rx-print-patient" data-testid="rx-print-patient">
        <span>
          {p.patientId && <span className="rx-print-id">ID {p.patientId} · </span>}
          <b>{p.name || '—'}</b>
          {ageSex ? ` · ${ageSex}` : ''}
          {p.area ? ` · ${p.area}` : ''}
          {p.token ? <span className="rx-print-token"> · Token {p.token}</span> : ''}
        </span>
        <span className="rx-print-date">{date}</span>
      </div>

      {exam.length > 0 && (
        <section className="rx-print-block" data-testid="rx-print-exam">
          <h2>Examination</h2>
          <table className="rx-print-grid rx-print-exam">
            <thead>
              <tr>
                <th />
                <th>Right eye</th>
                <th>Left eye</th>
              </tr>
            </thead>
            <tbody>
              {exam.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{r.label}</th>
                  <td>{r.r || '–'}</td>
                  <td>{r.l || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {glasses && (
        <section className="rx-print-block" data-testid="rx-print-glasses">
          <h2>
            Glass details
            {(glasses.lensTypes || []).length > 0 && (
              <span className="rx-print-lens">: {glasses.lensTypes.join(', ')}</span>
            )}
          </h2>
          {(glasses.rows || []).length > 0 && (
            <table className="rx-print-grid rx-print-glass">
              <thead>
                <tr>
                  <th rowSpan={2} />
                  <th colSpan={4}>Right eye</th>
                  <th colSpan={4} className="rx-print-l">
                    Left eye
                  </th>
                </tr>
                <tr>
                  {['R', 'L'].map((eye) =>
                    ['Sph', 'Cyl', 'Axis', 'VA'].map((f) => (
                      <th key={eye + f} className={eye === 'L' && f === 'Sph' ? 'rx-print-l' : ''}>
                        {f}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {glasses.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    {['r', 'l'].map((eye) =>
                      ['sph', 'cyl', 'axis', 'va'].map((f) => (
                        <td key={eye + f} className={eye === 'l' && f === 'sph' ? 'rx-print-l' : ''}>
                          {row[eye]?.[f] || '–'}
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(glasses.ipd || glasses.note) && (
            <div className="rx-print-glass-extra">
              {glasses.ipd && (
                <span>
                  IPD: <b>{glasses.ipd} mm</b>
                </span>
              )}
              {glasses.note && <span>{glasses.note}</span>}
            </div>
          )}
        </section>
      )}

      {lines.length > 0 && (
        <>
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
              {lines.map((l, i) => {
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
        </>
      )}
      {nextVisit && (
        <div className="rx-print-next" data-testid="rx-print-next">
          Next visit: <b>{fmtDate(String(nextVisit).slice(0, 10))}</b>
        </div>
      )}
      {footer && (
        <div className="rx-print-footnote" data-testid="rx-print-footnote">
          {footer}
        </div>
      )}
      <div className="rx-print-foot">
        <div className="rx-print-sign" data-testid="rx-print-sign">
          <div className="rx-print-sign-line" />
          <div>{docName}</div>
          {doc.degrees && <div className="rx-print-sign-sub">{doc.degrees}</div>}
          {regNo && <div className="rx-print-sign-sub">Reg. No. {regNo}</div>}
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
