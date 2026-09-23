/* API entry point. Screens import from here only:
     import { patients, visits } from '../../api';
   Each module is either the real axios adapter or the in-memory mock,
   chosen by VITE_USE_MOCKS (see .env.development). `USE_MOCKS` is exported
   so the shell can show a "mock data" hint. */
import * as real from './real';
import * as mocks from '../mocks/adapters';

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === '1';

const pick = (name) => (USE_MOCKS ? mocks[name] : real[name]);

export const auth = pick('auth');
export const patients = pick('patients');
export const visits = pick('visits');
export const appointments = pick('appointments');
export const readings = pick('readings');
export const ot = pick('ot');
export const prescriptions = pick('prescriptions');
export const inventory = pick('inventory');
export const admin = pick('admin');
export const mr = pick('mr');
export const config = pick('config');
export const treatments = pick('treatments');
export const imports = pick('imports');
export const billing = pick('billing');
export const reports = pick('reports');
export const reception = pick('reception');
export const doctor = pick('doctor');
export const family = pick('family');
export const fees = pick('fees');
export const intake = pick('intake');

export { errorMessage, session } from './client';
export { default as client } from './client';

// Mock-only: subscribe to store changes (no-op in real mode). Screens can use
// this to refresh after mutations; in real mode they should refetch/poll.
export function onDataChange(fn) {
  if (!USE_MOCKS) return () => {};
  return mocks.subscribeStore(fn);
}
