import {
  IconQueue,
  IconAppts,
  IconOT,
  IconMachines,
  IconMRs,
  IconStock,
  IconAdmin,
} from './components/Icons';

/* Navigation model shared by the desktop rail, the mobile slide-out menu and
   the mobile bottom nav. `roles` = who can see it (omit = everyone).
   The mockup's rail groups items under "Today" and "Manage". */
export const NAV_ITEMS = [
  { key: 'queue', label: 'Queue', path: '/queue', section: 'today', icon: IconQueue, mobileLabel: 'Queue' },
  {
    key: 'appointments',
    label: 'Appts',
    path: '/appointments',
    section: 'today',
    icon: IconAppts,
    mobileLabel: 'Appointments',
    emoji: '📅',
  },
  {
    key: 'ot',
    label: 'OT',
    path: '/ot',
    section: 'today',
    icon: IconOT,
    mobileLabel: 'OT',
    emoji: '🏥',
    roles: ['admin', 'doctor', 'ot_staff', 'reception'],
  },
  {
    key: 'machines',
    label: 'Machines',
    path: '/machines',
    section: 'today',
    icon: IconMachines,
    mobileLabel: 'Machines',
    emoji: '📷',
  },
  {
    key: 'mrs',
    label: 'MRs',
    path: '/mrs',
    section: 'manage',
    icon: IconMRs,
    mobileLabel: 'MR Visits',
    emoji: '🩺',
    roles: ['admin', 'doctor', 'reception'],
  },
  {
    key: 'inventory',
    label: 'Stock',
    path: '/inventory',
    section: 'manage',
    icon: IconStock,
    mobileLabel: 'Stock',
    emoji: '📦',
  },
  {
    key: 'admin',
    label: 'Admin',
    path: '/admin',
    section: 'manage',
    icon: IconAdmin,
    mobileLabel: 'Admin',
    emoji: '⚙',
    roles: ['admin'],
  },
];

// Bottom nav (mobile) shows these four plus a "Menu" button that opens the slide-out.
export const BOTTOM_NAV_KEYS = ['queue', 'appointments', 'machines', 'ot'];

export function navItemsForRole(role) {
  return NAV_ITEMS.filter((it) => !it.roles || it.roles.includes(role));
}

export function activeNavKey(pathname) {
  const seg = '/' + (pathname.split('/')[1] || '');
  const hit = NAV_ITEMS.find((it) => seg === it.path);
  return hit ? hit.key : null;
}

export const HOSPITAL_NAME = 'Gurukrupa Eye Hospital & Research Center';
export const HOSPITAL_SHORT = 'Gurukrupa';
export const DOCTOR_NAME = 'Dr. Anu Juneja Pathak';
