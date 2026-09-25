/* Glasses prescription helpers (lane R), shared by the doctor's panel, the printout and demo mode.
   Same rules as the server (backend/app/services/rx_print.py):
     Sph / Cyl — quarter-dioptre steps with a sign: '-2.5' → '-2.50', '1' → '+1.00', '0' → 'Plano'
     Axis      — whole number 0–180
     IPD       — millimetres, 40–85
   Each formatter returns the tidy text, or throws an Error whose message names the problem. */

export const EYES = [
  ['r', 'R'],
  ['l', 'L'],
];
export const LENS_ROWS = [
  ['dist', 'Dist'],
  ['near', 'Near'],
];
export const LENS_FIELDS = [
  ['sph', 'Sph'],
  ['cyl', 'Cyl'],
  ['axis', 'Axis'],
  ['va', 'VA'],
];

const blankRow = () => ({ sph: '', cyl: '', axis: '', va: '' });
export const emptyGlasses = () => ({
  r: { dist: blankRow(), near: blankRow() },
  l: { dist: blankRow(), near: blankRow() },
  lensTypes: [],
  ipd: '',
  note: '',
});

/** Any shape (null, partial) → a full Glasses object with every field a string. */
export function normalizeGlasses(g) {
  const out = emptyGlasses();
  if (!g) return out;
  EYES.forEach(([eye]) =>
    LENS_ROWS.forEach(([row]) =>
      LENS_FIELDS.forEach(([f]) => {
        const v = g?.[eye]?.[row]?.[f];
        out[eye][row][f] = v == null ? '' : String(v);
      })
    )
  );
  out.lensTypes = Array.isArray(g.lensTypes) ? [...g.lensTypes] : [];
  out.ipd = g.ipd == null ? '' : String(g.ipd);
  out.note = g.note || '';
  return out;
}

export const rowFilled = (g, row) =>
  !!g && EYES.some(([eye]) => LENS_FIELDS.some(([f]) => String(g?.[eye]?.[row]?.[f] ?? '').trim()));

export const glassesFilled = (g) =>
  !!g &&
  ((g.lensTypes || []).length > 0 ||
    !!String(g.ipd ?? '').trim() ||
    !!String(g.note ?? '').trim() ||
    LENS_ROWS.some(([row]) => rowFilled(g, row)));

function badValue(message) {
  const err = new Error(message);
  err.response = { status: 422, data: { detail: message } };
  return err;
}

export function fmtPower(text, what = 'Sph', limit = 30) {
  let s = String(text ?? '')
    .trim()
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/ds?$/, '');
  if (!s) return '';
  if (['pl', 'plano'].includes(s)) return 'Plano';
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s))
    throw badValue(`${what}: '${text}' is not a number (e.g. -2.75 or +1.00)`);
  const n = Number(s);
  if (Math.abs(n) > limit) throw badValue(`${what}: ${text} is out of range (up to ±${limit})`);
  if (Math.abs(n * 4 - Math.round(n * 4)) > 1e-9)
    throw badValue(`${what}: ${text} is not a quarter step (…, 1.00, 1.25, 1.50, 1.75, …)`);
  if (n === 0) return 'Plano';
  return (n > 0 ? '+' : '-') + Math.abs(n).toFixed(2);
}

export function fmtAxis(text, what = 'Axis') {
  const s = String(text ?? '')
    .trim()
    .replace(/[°º]$/, '')
    .trim();
  if (!s) return '';
  if (!/^\d{1,3}$/.test(s) || Number(s) > 180)
    throw badValue(`${what}: axis must be a whole number from 0 to 180`);
  return String(Number(s));
}

export function fmtIpd(text) {
  const s = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/mm$/, '')
    .trim();
  if (!s) return '';
  if (!/^\d+(\.\d+)?$/.test(s)) throw badValue(`IPD: '${text}' is not a number of millimetres (e.g. 66)`);
  const n = Number(s);
  if (n < 40 || n > 85) throw badValue(`IPD: ${text} mm is out of range (40–85 mm)`);
  return String(n);
}

/** Tidy a whole Glasses object (throws on the first bad value). null when nothing is filled in. */
export function cleanGlasses(g, knownLensTypes = null) {
  const src = normalizeGlasses(g);
  const out = emptyGlasses();
  EYES.forEach(([eye, eyeLabel]) =>
    LENS_ROWS.forEach(([row, rowLabel]) => {
      const where = `${eyeLabel} ${rowLabel}`;
      const v = src[eye][row];
      let cyl = fmtPower(v.cyl, `${where} Cyl`, 10);
      if (cyl === 'Plano') cyl = '';
      const axis = fmtAxis(v.axis, `${where} Axis`);
      if (cyl && !axis) throw badValue(`${where}: a cylinder needs an axis (0–180)`);
      out[eye][row] = {
        sph: fmtPower(v.sph, `${where} Sph`),
        cyl,
        axis,
        va: v.va.trim().replace(/\s+/g, ' '),
      };
    })
  );
  src.lensTypes.forEach((k) => {
    if (knownLensTypes && !knownLensTypes.includes(k)) throw badValue(`Unknown lens type '${k}'`);
    if (!out.lensTypes.includes(k)) out.lensTypes.push(k);
  });
  out.ipd = fmtIpd(src.ipd);
  out.note = src.note.trim();
  return glassesFilled(out) ? out : null;
}

/** Print form: only the Dist / Near rows with a value. */
export function printGlasses(g, lensLabel = (k) => k) {
  if (!glassesFilled(g)) return null;
  return {
    rows: LENS_ROWS.filter(([row]) => rowFilled(g, row)).map(([key, label]) => ({
      key,
      label,
      r: { ...g.r[key] },
      l: { ...g.l[key] },
    })),
    lensTypes: (g.lensTypes || []).map(lensLabel),
    ipd: g.ipd || '',
    note: g.note || '',
  };
}
