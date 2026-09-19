/* Printed-prescription header, from ../About the client.txt. The backend's
   GET /visits/{id}/prescription/print returns its own `hospital` block; these
   are the fallbacks when a field is missing. */
export const HOSPITAL_PRINT = {
  name: 'Guru Krupa Eye Hospital & Laser Center',
  tagline: 'Your Complete Eye Care Destination',
  address: '201/320, The Grand Plaza, Opp. Fire Station, VIP Road, Vesu, Surat',
  phone: '9328621216, 7574998502',
  doctor: 'Dr. Anu Juneja Pathak, M.S. Ophthalmology',
  timings: '9:00 AM – 7:00 PM · Monday to Saturday',
  logo: '/logo.jpg',
};

export const RX_LANGUAGES = [
  { key: 'english', label: 'English' },
  { key: 'hinglish', label: 'Hinglish' },
  { key: 'gujlish', label: 'Gujlish' },
];

/** Accepts either the real `/visits/today` row ({id, token, patient:{…}}) or the
 *  mock's flat patient row and returns one display shape. */
export function visitInfo(v) {
  if (!v) return { id: null, name: '—', age: null, sex: '', token: '' };
  const p = v.patient || v;
  return {
    id: v.id,
    visitId: v.visitId ?? v.id,
    name: p.name || v.name || '—',
    age: p.age ?? v.age ?? null,
    sex: p.sex ?? v.sex ?? '',
    token: v.token || p.token || '',
    stage: v.stage,
    hasPrescription: v.hasPrescription ?? (Array.isArray(v.medicines) ? v.medicines.length > 0 : false),
  };
}
