/* A visit's examination findings and glasses prescription on the patient page, in the printed
   form the history carries: exam [{label, r, l}], glasses {rows:[{key, label, r:{sph,cyl,axis,va},
   l:{…}}], lensTypes:[labels], ipd, note} | null. */
const FIELDS = ['sph', 'cyl', 'axis', 'va'];

function eyeText(v) {
  if (!v) return '–';
  const parts = [v.sph, v.cyl, v.axis ? `× ${v.axis}` : '', v.va ? `VA ${v.va}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '–';
}

export default function ExamGlassesBlock({ exam = [], glasses = null }) {
  return (
    <div className="patient-block" data-testid="patient-exam-glasses">
      {exam.length > 0 && (
        <>
          <div className="field-label">Examination</div>
          {exam.map((r, i) => (
            <div key={i} className="patient-rx-line">
              <b>{r.label}</b>
              <span>
                R: {r.r || '–'} · L: {r.l || '–'}
              </span>
            </div>
          ))}
        </>
      )}
      {glasses && (
        <>
          <div className="field-label">
            Glasses
            {(glasses.lensTypes || []).length > 0 && <span className="patient-dx"> · {glasses.lensTypes.join(', ')}</span>}
          </div>
          {(glasses.rows || [])
            .filter((row) => FIELDS.some((f) => row.r?.[f] || row.l?.[f]))
            .map((row) => (
              <div key={row.key} className="patient-rx-line">
                <b>{row.label}</b>
                <span className="num">
                  R {eyeText(row.r)} · L {eyeText(row.l)}
                </span>
              </div>
            ))}
          {(glasses.ipd || glasses.note) && (
            <div className="patient-rx-line">
              <b>{glasses.ipd ? `IPD ${glasses.ipd} mm` : ''}</b>
              <span>{glasses.note}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
