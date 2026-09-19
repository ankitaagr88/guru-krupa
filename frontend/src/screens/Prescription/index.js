/* Prescription (F7). The Queue drawer imports the modal from here:
     import { PrescriptionModal } from '../Prescription';
     <PrescriptionModal visit={visit} onClose={() => setRxOpen(false)} onSaved={refresh} />
   Default export is the doctor-facing /prescriptions list. */
export { default } from './PrescriptionsToday';
export { default as PrescriptionModal } from './PrescriptionModal';
export { default as PrescriptionsToday } from './PrescriptionsToday';
export { default as PrescriptionPrint } from './PrescriptionPrint';
export { default as IconRx } from './IconRx';
export { HOSPITAL_PRINT, RX_LANGUAGES, visitInfo } from './hospital';
