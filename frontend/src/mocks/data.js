/* Seed data — copied faithfully from docs/mockup-reference.html (lines ~941–1144).
   These are the *initial* values; src/mocks/store.js clones them into a mutable
   in-memory store so mock adapters can behave like a live backend. Keep the
   shapes identical to the mockup — the backend tables mirror them (B2). */

export function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const MIN = 60 * 1000;

// A date of birth that makes someone `age` today, so the demo DOB and age always agree.
function dobForAge(age) {
  const d = new Date();
  d.setDate(1);
  d.setFullYear(d.getFullYear() - age);
  d.setMonth(d.getMonth() - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const STAGES = [
  { key: 'reg', label: 'Registration', cls: 'reg' },
  { key: 'pretest', label: 'Pre-testing', cls: 'pretest' },
  { key: 'doctor', label: 'With Doctor', cls: 'doctor' },
  { key: 'dilate', label: 'Dilating · Wait', cls: 'dilate' },
  { key: 'billing', label: 'Billing', cls: 'billing' },
  { key: 'done', label: 'Done', cls: 'done' },
];

export const PROTOCOL_STEPS = [
  { name: 'Tropicamide 0.8%', min: 5 },
  { name: 'Cyclopentolate 1%', min: 20 },
];

export const REFERRAL_SOURCES = [
  { key: 'self', label: 'Self / Walk-in' },
  { key: 'doctor', label: 'Referred by another doctor' },
  { key: 'patient', label: 'Referred by family / another patient' },
  { key: 'online', label: 'Online / Google' },
  { key: 'bni', label: 'BNI' },
  { key: 'insurance', label: 'Insurance / TPA' },
  { key: 'camp', label: 'Camp / Outreach' },
];
export const REFERRAL_NEEDS_DETAIL = ['doctor', 'patient'];

export const CONDITIONS = [
  'Diabetes',
  'Hypertension',
  'Asthma',
  'Arthritis',
  'Thyroid disorder',
  'Heart disease / stroke history',
  'Allergy',
  'Acidity / GERD',
  'BPH',
];

// Note: the mockup's patients are one-record-per-visit (a "patient" row *is*
// today's visit — it carries token, stage, stageEnteredAt). The real backend
// splits this into patients + visits; the mock keeps the mockup shape.
export function seedPatients() {
  const now = Date.now();
  const patients = [
    {
      id: 1,
      name: 'Rasilaben Patel',
      token: '#014',
      dob: dobForAge(62),
      age: 62,
      sex: 'F',
      phone: '98250 12345',
      address: 'Vesu, Surat',
      occupation: 'Homemaker',
      screenHours: 1,
      stage: 'reg',
      elsewhere: false,
      note: 'First visit',
      stageEnteredAt: now - MIN * 6,
      language: 'gujarati',
      referralSource: 'doctor',
      referralDetail: 'Dr. Shah',
    },
    {
      id: 2,
      name: 'Kiran Vaghela',
      token: '#015',
      age: 34,
      sex: 'M',
      phone: '99250 67890',
      address: 'Adajan, Surat',
      occupation: 'Software developer',
      screenHours: 9,
      stage: 'reg',
      elsewhere: false,
      note: 'Blurred vision, 3 days',
      stageEnteredAt: now - MIN * 2,
      language: null,
      referralSource: 'online',
      referralDetail: '',
    },
    {
      id: 3,
      name: 'Mahesh Desai',
      token: '#011',
      age: 58,
      sex: 'M',
      phone: '97250 23456',
      address: 'Athwa, Surat',
      stage: 'pretest',
      elsewhere: true,
      note: 'Cataract op, Rajkot, 2018',
      readings: [],
      stageEnteredAt: now - MIN * 22,
      referralSource: 'patient',
      referralDetail: 'Referred by his brother, an existing patient',
    },
    {
      id: 4,
      name: 'Falguni Shah',
      token: '#012',
      age: 29,
      sex: 'F',
      phone: '98980 34567',
      address: 'City Light, Surat',
      stage: 'pretest',
      elsewhere: false,
      note: 'Routine checkup',
      stageEnteredAt: now - MIN * 9,
      referralSource: 'self',
      referralDetail: '',
      va: { R: '6/9', L: '6/6' },
      readings: [
        {
          machine: 'HRK-8000A — Refraction (REF)',
          src: 'scanned, 11:42 AM',
          vals: [
            { l: 'SPH (R)', v: '-1.00' },
            { l: 'CYL (R)', v: '-0.50' },
            { l: 'AX (R)', v: '90' },
            { l: 'SPH (L)', v: '-0.75' },
            { l: 'CYL (L)', v: '-0.50' },
            { l: 'AX (L)', v: '85' },
            { l: 'PD', v: '64mm' },
          ],
        },
      ],
    },
    {
      id: 5,
      name: 'Bharat Oza',
      token: '#009',
      age: 71,
      sex: 'M',
      phone: '90999 45678',
      address: 'Ghod Dod Road, Surat',
      stage: 'doctor',
      elsewhere: true,
      note: 'Glaucoma, ongoing drops',
      stageEnteredAt: now - MIN * 14,
      lastVisitDate: dateStr(-42),
      referralSource: 'insurance',
      referralDetail: '',
      va: { R: '6/18', L: '6/24' },
      existingConditions: ['Diabetes', 'Hypertension'],
      conditionOther: '',
      readings: [
        {
          machine: 'HNT-1P — Tono-Pachy (IOP & CCT)',
          src: 'scanned, 10:05 AM',
          vals: [
            { l: 'IOP (R)', v: '24' },
            { l: 'IOP (L)', v: '26' },
            { l: 'CIOP (R)', v: '24' },
            { l: 'CIOP (L)', v: '26' },
            { l: 'CCT (R)', v: '520' },
            { l: 'CCT (L)', v: '515' },
          ],
        },
      ],
      diagnosisId: 8,
      medicines: [
        { name: 'Timolol 0.5% eye drops', matched: true, dosage: '1 drop both eyes, twice daily' },
        { name: 'Latanoprost 0.005% eye drops', matched: false, dosage: '1 drop both eyes, at night' },
      ],
    },
    {
      id: 6,
      name: 'Sangita Rana',
      token: '#007',
      age: 45,
      sex: 'F',
      phone: '98251 56789',
      address: 'Piplod, Surat',
      stage: 'dilate',
      elsewhere: false,
      stageEnteredAt: now - MIN * 16,
      dilation: {
        currentIndex: 1,
        steps: [
          { name: 'Tropicamide 0.8%', min: 5, given: true, startedAt: now - MIN * 16, done: true },
          { name: 'Cyclopentolate 1%', min: 20, given: true, startedAt: now - MIN * 11, done: false },
        ],
      },
    },
    {
      id: 7,
      name: 'Ilaben Chauhan',
      token: '#005',
      age: 67,
      sex: 'F',
      phone: '99789 67890',
      address: 'Varachha, Surat',
      stage: 'dilate',
      elsewhere: true,
      stageEnteredAt: now - MIN * 28,
      lastVisitDate: dateStr(-14),
      dilation: {
        currentIndex: 1,
        steps: [
          { name: 'Tropicamide 0.8%', min: 5, given: true, startedAt: now - MIN * 28, done: true },
          { name: 'Cyclopentolate 1%', min: 20, given: true, startedAt: now - MIN * 23, done: false },
        ],
      },
    },
    {
      id: 8,
      name: 'Chirag Mehta',
      token: '#003',
      age: 38,
      sex: 'M',
      phone: '97125 78901',
      address: 'Rander, Surat',
      stage: 'billing',
      elsewhere: false,
      stageEnteredAt: now - MIN * 4,
      referralSource: 'self',
      referralDetail: '',
      bill: {
        items: [
          { label: 'Consultation fee', amount: 500 },
          { label: 'Pre-test charges', amount: 250 },
        ],
        paymentMode: null,
      },
    },
    {
      id: 9,
      name: 'Pooja Trivedi',
      token: '#001',
      age: 52,
      sex: 'F',
      phone: '98240 89012',
      address: 'Nanpura, Surat',
      stage: 'done',
      elsewhere: false,
      stageEnteredAt: now - MIN * 45,
    },
  ];
  return patients.map(normalizePatient);
}

// Mirrors the mockup's `patients.forEach(p => {...})` defaults block.
export function normalizePatient(p) {
  const out = { ...p };
  if (!out.readings) out.readings = [];
  if (!out.medicines) out.medicines = [];
  if (out.referralSource === undefined) out.referralSource = 'self';
  if (out.referralDetail === undefined) out.referralDetail = '';
  if (out.elsewhereNote === undefined) out.elsewhereNote = '';
  if (!out.bill) out.bill = { items: [], paymentMode: null };
  if (out.doctorNotes === undefined) out.doctorNotes = '';
  if (!out.examPhotos) out.examPhotos = [];
  if (!out.stageEnteredAt) out.stageEnteredAt = Date.now();
  if (out.lastVisitDate === undefined) out.lastVisitDate = null;
  if (!out.va) out.va = { R: '', L: '' };
  if (!out.language) out.language = null;
  if (out.occupation === undefined) out.occupation = '';
  if (out.screenHours === undefined) out.screenHours = null;
  if (!out.existingConditions) out.existingConditions = [];
  if (out.conditionOther === undefined) out.conditionOther = '';
  if (out.lastVisit === undefined) out.lastVisit = null;
  if (out.note === undefined) out.note = '';
  if (out.dob === undefined) out.dob = null;
  return out;
}

/* Phone-keyed visit history — lets a returning patient's last visit auto-fetch
   even though each visit creates a separate patient record. */
export const PATIENT_HISTORY = {
  '90999 45678': ['2026-08-18'], // Bharat Oza — monthly glaucoma follow-up
  '99789 67890': ['2026-07-30'], // Ilaben Chauhan
};

export function seedAppointments() {
  return [
    {
      id: 1,
      name: 'Priya Mehta',
      phone: '98250 11223',
      date: dateStr(0),
      channel: 'whatsapp',
      checkedIn: false,
    },
    {
      id: 2,
      name: 'Suresh Bhatt',
      phone: '99250 44556',
      date: dateStr(0),
      channel: 'call',
      checkedIn: false,
    },
    {
      id: 3,
      name: 'Anjali Rathod',
      phone: '97250 77889',
      date: dateStr(0),
      channel: 'walkin',
      checkedIn: true,
    },
    {
      id: 4,
      name: 'Kishor Panchal',
      phone: '98980 33221',
      date: dateStr(1),
      channel: 'whatsapp',
      checkedIn: false,
    },
    {
      id: 5,
      name: 'Heena Solanki',
      phone: '90999 12121',
      date: dateStr(1),
      channel: 'call',
      checkedIn: false,
    },
  ];
}

// Medicine types (backend MedicineForm seed). Admin-editable; `Medicine.form` stores the key.
/* Starter diagnoses for the treatment standards (admin-editable). Seeded prescriptions below
   carry a diagnosisId so the history-derived standard has something to count. */
export const DIAGNOSES = [
  'Dry eye',
  'Allergic conjunctivitis',
  'Bacterial conjunctivitis',
  'Viral conjunctivitis',
  'Computer vision syndrome',
  'Refractive error',
  'Cataract',
  'Glaucoma',
  'Blepharitis',
  'Stye (hordeolum)',
  'Post-operative care',
].map((name, i) => ({ id: i + 1, name, active: true, sortOrder: i }));

export const MEDICINE_FORMS = [
  ['drops', 'Drops'],
  ['gel', 'Gel'],
  ['ointment', 'Ointment'],
  ['suspension', 'Suspension'],
  ['tablet', 'Tablet'],
  ['capsule', 'Capsule'],
  ['syrup', 'Syrup'],
  ['gummies', 'Gummies'],
].map(([key, label], i) => ({ id: i + 1, key, label, sortOrder: i, active: true }));

/** Best-effort form key from a name ("… eye ointment" → ointment); default drops. */
export function guessMedicineForm(text) {
  const t = (text || '').toLowerCase();
  for (const f of ['ointment', 'tablet', 'capsule', 'suspension', 'syrup', 'gummies', 'gel']) {
    if (t.includes(f)) return f;
  }
  return 'drops';
}

// Generic-only rows from the mockup: name == composition, no brand.
export const MEDICINE_LIST = [
  'Moxifloxacin 0.5% eye drops',
  'Prednisolone acetate 1% eye drops',
  'Ketorolac 0.5% eye drops',
  'Carboxymethylcellulose 0.5% (tear drops)',
  'Timolol 0.5% eye drops',
  'Latanoprost 0.005% eye drops',
  'Homatropine 2% eye drops',
  'Tobramycin + Dexamethasone eye drops',
  'Ofloxacin eye ointment',
  'Acetazolamide 250mg tablets',
];

// Branded packs (the chemist dispenses by brand; the sheet prints brand with the
// composition underneath). name == brand. [brand, composition, form, strength, packSize, manufacturer]
export const MEDICINE_BRANDS = [
  ['Aquaray Gel', 'Carboxymethylcellulose sodium eye drops IP', 'gel', '0.5%', '10 ml', 'Raymed'],
  [
    'MOSI LP',
    'Moxifloxacin Hydrochloride & Loteprednol Etabonate ophthalmic suspension',
    'suspension',
    '0.5% / 0.5%',
    '5 ml',
    'FDC',
  ],
];

/** Every seeded medicine as a store row (generics first, then brands) — mirrors the backend seed. */
export function seedMedicines() {
  const rows = MEDICINE_LIST.map((n) => ({
    name: n,
    brand: null,
    composition: n,
    form: guessMedicineForm(n),
    strength: null,
    packSize: null,
    manufacturer: null,
    active: true,
  }));
  MEDICINE_BRANDS.forEach(([brand, composition, form, strength, packSize, manufacturer]) => {
    rows.push({ name: brand, brand, composition, form, strength, packSize, manufacturer, active: true });
  });
  return rows.map((r, i) => ({ id: i + 1, ...r }));
}

export const INVENTORY = [
  { name: 'Tropicamide 0.8%', unit: 'bottles', stock: 8, reorder: 5 },
  { name: 'Cyclopentolate 1%', unit: 'bottles', stock: 3, reorder: 5 },
  { name: 'Moxifloxacin 0.5% eye drops', unit: 'bottles', stock: 12, reorder: 6 },
  { name: 'Prednisolone acetate 1% eye drops', unit: 'bottles', stock: 10, reorder: 6 },
  { name: 'Ketorolac 0.5% eye drops', unit: 'bottles', stock: 7, reorder: 6 },
  { name: 'Carboxymethylcellulose 0.5% (tear drops)', unit: 'bottles', stock: 15, reorder: 8 },
  { name: 'Timolol 0.5% eye drops', unit: 'bottles', stock: 9, reorder: 6 },
  { name: 'Latanoprost 0.005% eye drops', unit: 'bottles', stock: 4, reorder: 6 },
  { name: 'Homatropine 2% eye drops', unit: 'bottles', stock: 6, reorder: 5 },
  { name: 'Tobramycin + Dexamethasone eye drops', unit: 'bottles', stock: 8, reorder: 6 },
  { name: 'Ofloxacin eye ointment', unit: 'tubes', stock: 5, reorder: 4 },
  { name: 'Acetazolamide 250mg tablets', unit: 'strips', stock: 20, reorder: 10 },
];

export const MR_VISITS = [
  {
    id: 1,
    repName: 'Rajesh Kumar',
    company: 'Sun Pharma',
    phone: '98240 11111',
    products: 'Moxifloxacin, Prednisolone acetate',
    visitDate: '3 days ago',
    nextVisitDate: 'in ~2 weeks',
    notes: 'Left samples of new Moxifloxacin batch',
  },
  {
    id: 2,
    repName: 'Anita Desai',
    company: 'Cipla',
    phone: '99250 22222',
    products: 'Latanoprost, Timolol',
    visitDate: '10 days ago',
    nextVisitDate: 'in ~1 week',
    notes: '',
  },
  {
    id: 3,
    repName: 'Rajesh Kumar',
    company: 'Sun Pharma',
    phone: '98240 11111',
    products: 'Moxifloxacin, Carboxymethylcellulose (tear drops)',
    visitDate: '6 weeks ago',
    nextVisitDate: '',
    notes: 'First introduction visit',
  },
];

export const LENS_TIERS = [
  { key: 'monofocal', label: 'Monofocal IOL', price: 28500 },
  { key: 'multifocal', label: 'Multifocal / Trifocal IOL', price: 45000 },
  { key: 'toric', label: 'Toric IOL', price: 38000 },
];

export function emptyOtOperative() {
  return {
    iolBrand: '',
    iolPower: '',
    technique: '',
    anesthesia: '',
    surgeon: 'Dr. Anu Juneja Pathak',
    complications: '',
    notes: '',
  };
}
export function emptyOtPostOp() {
  return {
    followUpNotes: '',
    followUpVA: { R: '', L: '' },
    nextFollowUp: '',
    finalRx: { R: { sph: '', cyl: '', axis: '', va: '' }, L: { sph: '', cyl: '', axis: '', va: '' } },
  };
}
export function emptyOtBilling() {
  return { lensTier: null, mediclaim: false, paymentMode: null };
}

// Backend B7: 11 slots, 9:00 AM to 4:30 PM every 45 minutes (GET /ot/slots).
export const OT_TIME_SLOTS = [
  '9:00 AM',
  '9:45 AM',
  '10:30 AM',
  '11:15 AM',
  '12:00 PM',
  '12:45 PM',
  '1:30 PM',
  '2:15 PM',
  '3:00 PM',
  '3:45 PM',
  '4:30 PM',
];
export const OT_PROCEDURES = [
  'Cataract — Phaco with IOL (OD)',
  'Cataract — Phaco with IOL (OS)',
  'Cataract — Phaco with IOL (OU, staged)',
  'LASIK',
  'Other',
];

export function seedOtCases() {
  return [
    {
      id: 1,
      patientName: 'Rujavana Madhani',
      age: 52,
      sex: 'F',
      date: dateStr(0),
      timeSlot: '9:00 AM',
      procedure: 'Cataract — Phaco with IOL (OD)',
      status: 'scheduled',
      preOpBiometry: {
        AL: { R: '22.90mm', L: '22.80mm' },
        ACD: { R: '2.70mm', L: '2.77mm' },
        K1: { R: '43.27D', L: '43.34D' },
        K2: { R: '43.48D', L: '43.93D' },
        targetRefraction: { R: '-0.04D', L: '0.03D' },
      },
      operative: emptyOtOperative(),
      consentPhotos: [],
      postOp: emptyOtPostOp(),
      billing: emptyOtBilling(),
    },
    {
      id: 2,
      patientName: 'Kulpal Singh',
      age: 41,
      sex: 'M',
      date: dateStr(2),
      timeSlot: '11:15 AM',
      procedure: 'Cataract — Phaco with IOL (OS)',
      status: 'scheduled',
      preOpBiometry: {
        AL: { R: '23.10mm', L: '23.05mm' },
        ACD: { R: '2.85mm', L: '2.80mm' },
        K1: { R: '44.10D', L: '43.95D' },
        K2: { R: '44.50D', L: '44.20D' },
        targetRefraction: { R: '-0.25D', L: '0.00D' },
      },
      operative: emptyOtOperative(),
      consentPhotos: [],
      postOp: emptyOtPostOp(),
      billing: emptyOtBilling(),
    },
    {
      id: 3,
      patientName: 'Meena Rathod',
      age: 63,
      sex: 'F',
      date: dateStr(-3),
      timeSlot: '2:15 PM',
      procedure: 'Cataract — Phaco with IOL (OU, staged)',
      status: 'completed',
      preOpBiometry: {
        AL: { R: '22.50mm', L: '22.60mm' },
        ACD: { R: '2.60mm', L: '2.65mm' },
        K1: { R: '42.80D', L: '43.00D' },
        K2: { R: '43.20D', L: '43.40D' },
        targetRefraction: { R: '0.00D', L: '0.00D' },
      },
      operative: {
        iolBrand: 'Hoya AF-1 FY-60AD',
        iolPower: '22.5D',
        technique: 'Phacoemulsification',
        anesthesia: 'Topical',
        surgeon: 'Dr. Anu Juneja Pathak',
        complications: 'None',
        notes: 'Uneventful surgery, good red reflex maintained throughout.',
      },
      consentPhotos: [{ id: 1, capturedAt: '10:15 AM, 3 days ago' }],
      postOp: {
        followUpNotes: 'Wound stable, no signs of infection. Patient comfortable.',
        followUpVA: { R: '6/9', L: '—' },
        nextFollowUp: 'in 1 week',
        finalRx: {
          R: { sph: '-0.25', cyl: '-0.50', axis: '90', va: '6/6' },
          L: { sph: '', cyl: '', axis: '', va: '' },
        },
      },
      billing: { lensTier: 'monofocal', mediclaim: true, paymentMode: 'mediclaim' },
    },
  ];
}

export const TEST_TYPES = [
  {
    machine: 'HNT-1P — Tono-Pachy (IOP & CCT)',
    vals: [
      { l: 'IOP (R)', v: '13' },
      { l: 'IOP (L)', v: '12' },
      { l: 'CIOP (R)', v: '15' },
      { l: 'CIOP (L)', v: '15' },
      { l: 'CCT (R)', v: '499' },
      { l: 'CCT (L)', v: '508' },
    ],
  },
  {
    machine: 'HRK-8000A — Refraction (REF)',
    vals: [
      { l: 'SPH (R)', v: '-0.25' },
      { l: 'CYL (R)', v: '-2.00' },
      { l: 'AX (R)', v: '166' },
      { l: 'SPH (L)', v: '-0.25' },
      { l: 'CYL (L)', v: '-1.75' },
      { l: 'AX (L)', v: '164' },
      { l: 'PD', v: '66mm' },
    ],
  },
  {
    machine: 'HRK-8000A — Keratometry (KER)',
    vals: [
      { l: 'K1 (R)', v: '42.70' },
      { l: 'K2 (R)', v: '43.30' },
      { l: 'K1 (L)', v: '41.60' },
      { l: 'K2 (L)', v: '43.50' },
    ],
  },
  {
    machine: 'CLM-1 — Current Glasses (Lensmeter)',
    vals: [
      { l: 'SPH (R)', v: '-0.75' },
      { l: 'CYL (R)', v: '-1.75' },
      { l: 'AXS (R)', v: '174' },
      { l: 'SPH (L)', v: '-0.50' },
      { l: 'CYL (L)', v: '-1.25' },
      { l: 'AXS (L)', v: '163' },
    ],
  },
  {
    machine: 'YPC-100K — Refraction (REF)',
    vals: [
      { l: 'SPH (R)', v: '-1.75' },
      { l: 'CYL (R)', v: '-0.25' },
      { l: 'AX (R)', v: '60' },
      { l: 'SPH (L)', v: '-1.25' },
      { l: 'CYL (L)', v: '-0.25' },
      { l: 'AX (L)', v: '45' },
      { l: 'PD', v: '65mm' },
    ],
  },
  {
    machine: 'YPC-100K — Keratometry (KER)',
    vals: [
      { l: 'K1 (R)', v: '44.50' },
      { l: 'K2 (R)', v: '44.75' },
      { l: 'K1 (L)', v: '44.75' },
      { l: 'K2 (L)', v: '45.00' },
    ],
  },
  {
    machine: 'TBUT / Schimer I',
    vals: [
      { l: 'TBUT (R)', v: '8s' },
      { l: 'TBUT (L)', v: '9s' },
      { l: 'Schimer (R)', v: '12mm' },
      { l: 'Schimer (L)', v: '14mm' },
    ],
  },
];

export const STAFF = [
  { id: 1, name: 'Dr. Anu Juneja Pathak', username: 'admin', role: 'admin', active: true, phone: '9328621216' },
  { id: 2, name: 'Dr. Anu Juneja Pathak', username: 'doctor', role: 'doctor', active: true, phone: '7574998502' },
  { id: 3, name: 'Optometrist', username: 'optom', role: 'optometrist', active: true, phone: '9000000003' },
  { id: 4, name: 'Reception desk', username: 'reception', role: 'reception', active: true, phone: '9000000004' },
  { id: 5, name: 'OT staff', username: 'ot', role: 'ot_staff', active: true, phone: '9000000005' },
];
