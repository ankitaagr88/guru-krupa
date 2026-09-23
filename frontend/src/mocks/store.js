/* In-memory mutable store for mock mode. Seeded from ./data.js; every mock
   adapter reads/writes here so the UI feels live (stage moves, stock
   decrements, new appointments all persist for the page session).
   `subscribe(fn)` fires after every mutation — AppShell uses it to refresh
   stage counts in the rail/mobile nav. */
import * as D from './data';

const clone = (v) => JSON.parse(JSON.stringify(v));

function createStore() {
  const state = {
    stages: clone(D.STAGES),
    protocolSteps: clone(D.PROTOCOL_STEPS).map((s, i) => ({ id: i + 1, ...s })),
    referralSources: clone(D.REFERRAL_SOURCES),
    patients: D.seedPatients(),
    patientHistory: clone(D.PATIENT_HISTORY),
    appointments: D.seedAppointments(),
    medicines: D.seedMedicines(), // {id, name, brand, composition, form, strength, packSize, manufacturer, active}
    medicineForms: clone(D.MEDICINE_FORMS),
    diagnoses: clone(D.DIAGNOSES),
    otSlots: D.OT_TIME_SLOTS.map((label, i) => ({ id: i + 1, label, active: true, sortOrder: i })),
    otProcedures: D.OT_PROCEDURES.map((name, i) => ({ id: i + 1, name, active: true, sortOrder: i })),
    standardCharges: clone(D.STANDARD_CHARGES), // lane B: one-tap bill charges
    visitKinds: clone(D.VISIT_KINDS), // lane E2: new patient / follow-up / new case…
    feeRules: clone(D.FEE_RULES),
    treatmentStandards: {}, // diagnosisId -> {lines, updatedAt, updatedBy}
    inventory: clone(D.INVENTORY).map((it, i) => ({ id: i + 1, ...it })),
    stockMovements: [],
    mrVisits: clone(D.MR_VISITS),
    lensTiers: clone(D.LENS_TIERS),
    otCases: D.seedOtCases(),
    readings: [], // {id, patientId, machine, status, vals, src, clientUuid}
    staff: clone(D.STAFF),
    seq: {
      patient: 9,
      token: 15,
      appointment: 5,
      mr: 3,
      ot: 3,
      reading: 0,
      inventory: D.INVENTORY.length,
      staff: D.STAFF.length,
      stage: D.STAGES.length,
      protocol: D.PROTOCOL_STEPS.length,
      referral: D.REFERRAL_SOURCES.length,
      medicine: D.MEDICINE_LIST.length + D.MEDICINE_BRANDS.length,
      medicineForm: D.MEDICINE_FORMS.length,
      diagnosis: D.DIAGNOSES.length,
      otSlot: D.OT_TIME_SLOTS.length,
      otProcedure: D.OT_PROCEDURES.length,
      standardCharge: D.STANDARD_CHARGES.length,
      visitKind: D.VISIT_KINDS.length,
      billItem: 100,
      receipt: 0, // per-year sequence of demo receipt numbers (GK-YYYY-00001…)
    },
  };

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(state));

  return {
    state,
    clone,
    nextId(key) {
      state.seq[key] = (state.seq[key] || 0) + 1;
      return state.seq[key];
    },
    nextToken() {
      state.seq.token += 1;
      return '#' + String(state.seq.token).padStart(3, '0');
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notify,
    reset() {
      const fresh = createStore().state;
      Object.keys(fresh).forEach((k) => {
        state[k] = fresh[k];
      });
      notify();
    },
  };
}

export const store = createStore();

// Simulated network latency so loading states are visible in mock mode.
export const latency = (ms = 120) => new Promise((r) => setTimeout(r, ms));
