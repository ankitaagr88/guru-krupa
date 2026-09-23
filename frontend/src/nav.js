import {
  IconQueue,
  IconAppts,
  IconOT,
  IconMachines,
  IconMRs,
  IconStock,
  IconAdmin,
  IconToday,
} from './components/Icons';
import IconRx from './screens/Prescription/IconRx';

/* Navigation model shared by the desktop SideNav, the mobile overflow sheet and
   the BottomTabBar. `roles` = who can see it (omit = everyone).
   `label` is the short tab label; `fullLabel` is what the labelled SideNav shows.
   Two groups, "Today" and "Manage" (design-system/navigation.md). */
export const NAV_ITEMS = [
  { key: 'queue', label: 'Queue', fullLabel: 'Queue', path: '/queue', section: 'today', icon: IconQueue },
  {
    key: 'appointments',
    label: 'Appts',
    fullLabel: 'Appointments',
    path: '/appointments',
    section: 'today',
    icon: IconAppts,
  },
  {
    key: 'ot',
    label: 'OT',
    fullLabel: 'Operation theatre',
    path: '/ot',
    section: 'today',
    icon: IconOT,
    roles: ['admin', 'doctor', 'ot_staff', 'reception'],
  },
  {
    key: 'machines',
    label: 'Machines',
    fullLabel: 'Machines',
    path: '/machines',
    section: 'today',
    icon: IconMachines,
  },
  {
    key: 'prescriptions',
    label: 'Rx',
    fullLabel: 'Prescriptions',
    path: '/prescriptions',
    section: 'today',
    icon: IconRx,
    roles: ['admin', 'doctor'],
  },
  {
    key: 'today',
    label: 'Today',
    fullLabel: "Today's summary",
    path: '/today',
    section: 'today',
    icon: IconToday,
    roles: ['admin', 'doctor', 'reception'],
  },
  {
    key: 'mrs',
    label: 'MRs',
    fullLabel: 'MR visits',
    path: '/mrs',
    section: 'manage',
    icon: IconMRs,
    roles: ['admin', 'doctor', 'reception'],
  },
  {
    key: 'inventory',
    label: 'Stock',
    fullLabel: 'Stock',
    path: '/inventory',
    section: 'manage',
    icon: IconStock,
  },
  {
    key: 'admin',
    label: 'Admin',
    fullLabel: 'Admin',
    path: '/admin',
    section: 'manage',
    icon: IconAdmin,
    roles: ['admin'],
  },
];

// BottomTabBar (mobile): the destinations reception uses all day, plus "More".
export const BOTTOM_NAV_KEYS = ['queue', 'appointments', 'ot', 'machines'];

export function navItemsForRole(role) {
  return NAV_ITEMS.filter((it) => !it.roles || it.roles.includes(role));
}

export function activeNavKey(pathname) {
  const seg = '/' + (pathname.split('/')[1] || '');
  const hit = NAV_ITEMS.find((it) => seg === it.path);
  return hit ? hit.key : null;
}

/* The name on the logo, which is the name that prints on every prescription. */
export const HOSPITAL_NAME = 'Guru Krupa Eye Hospital & Laser Center';
export const HOSPITAL_SHORT = 'Guru Krupa';
export const HOSPITAL_WORDMARK = 'GURU KRUPA';
export const HOSPITAL_SUBTITLE = 'Eye Hospital & Laser Center';
export const DOCTOR_NAME = 'Dr. Anu Juneja Pathak';
