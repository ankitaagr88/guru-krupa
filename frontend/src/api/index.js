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

export { errorMessage, session } from './client';
export { default as client } from './client';

// Mock-only: subscribe to store changes (no-op in real mode). Screens can use
// this to refresh after mutations; in real mode they should refetch/poll.
export function onDataChange(fn) {
  if (!USE_MOCKS) return () => {};
  return mocks.subscribeStore(fn);
}
