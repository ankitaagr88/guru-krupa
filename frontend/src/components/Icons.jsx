/* 24x24 outline icons, Feather-style: stroke currentColor, width 2. They inherit
   colour from their container (design-system/brand-book.md, Iconography). */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/* Placeholder mark until the clinic supplies a vector logo: an outline eye in
   currentColor, so it takes the colour of whatever it sits on. */
export const EyeMark = ({ color = 'currentColor' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" fill={color} stroke="none" />
  </svg>
);
export const IconQueue = () => (
  <svg {...base}>
    <path d="M4 6h16M4 12h16M4 18h10" />
    <circle cx="19" cy="18" r="2" />
  </svg>
);
export const IconAppts = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4" />
  </svg>
);
export const IconOT = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4l3 2" />
    <path d="M9 3l1.5 2M15 3l-1.5 2" />
  </svg>
);
export const IconMachines = () => (
  <svg {...base}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <circle cx="12" cy="14" r="3" />
    <path d="M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2" />
  </svg>
);
export const IconMRs = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3" />
    <path d="M2 20c0-3 3-5 7-5s7 2 7 5" />
    <path d="M17 8h5M17 12h5M17 16h3" />
  </svg>
);
export const IconStock = () => (
  <svg {...base}>
    <path d="M21 8l-9-5-9 5 9 5 9-5z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </svg>
);
export const IconAdmin = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34H9a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87V9a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z" />
  </svg>
);
export const IconToday = () => (
  <svg {...base}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
export const IconSearch = () => (
  <svg {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);
export const IconMenu = () => (
  <svg {...base}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);
export const IconLogout = () => (
  <svg {...base}>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);
export const IconMore = () => (
  <svg {...base}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" />
  </svg>
);
export const IconChevronLeft = () => (
  <svg {...base}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
export const IconCamera = () => (
  <svg {...base}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IconPaperclip = () => (
  <svg {...base}>
    <path d="M21 11.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.6 1.6 0 01-2.3-2.3l8.3-8.3" />
  </svg>
);
export const IconPrint = () => (
  <svg {...base}>
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
    <rect x="6" y="14" width="12" height="7" />
  </svg>
);
export const IconPencil = () => (
  <svg {...base}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);
export const IconUpload = () => (
  <svg {...base}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <path d="M17 8l-5-5-5 5M12 3v12" />
  </svg>
);
export const IconDownload = () => (
  <svg {...base}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <path d="M7 10l5 5 5-5M12 15V3" />
  </svg>
);
export const IconPhone = () => (
  <svg {...base}>
    <rect x="6" y="2" width="12" height="20" rx="2" />
    <path d="M11 18h2" />
  </svg>
);
export const IconAlert = () => (
  <svg {...base}>
    <path d="M12 3l10 18H2L12 3z" />
    <path d="M12 10v4M12 17.5v.5" />
  </svg>
);
export const IconCheck = () => (
  <svg {...base}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);
export const IconClock = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const IconWifiOff = () => (
  <svg {...base}>
    <path d="M2 2l20 20" />
    <path d="M8.5 16.5a5 5 0 017 0M5 13a10 10 0 015.2-2.8M12 20h.01M19 13a10 10 0 00-2.3-1.7M2 9a15 15 0 013.6-2.4M22 9a15 15 0 00-9-3.9" />
  </svg>
);
/* Day book: an open ledger (lines of entries), not the chart used by "Today's summary". */
export const IconLedger = () => (
  <svg {...base}>
    <path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3V4z" />
    <path d="M4 17a3 3 0 013-3h11" />
    <path d="M8 8h6M8 11h4" />
  </svg>
);
/* Bill / payment: a rupee sign. */
export const IconRupee = () => (
  <svg {...base}>
    <path d="M6 4h12M6 9h12M9 4c6 0 6 10 0 10H6l8 7" />
  </svg>
);
/* Family: two people. */
export const IconFamily = () => (
  <svg {...base}>
    <circle cx="9" cy="7" r="3" />
    <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16 14.2c2.9.3 5 2 5 4.8" />
  </svg>
);
/* Queue: add someone (a person with a plus). */
export const IconPersonAdd = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    <path d="M19 8v6M16 11h6" />
  </svg>
);
