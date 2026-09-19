/* Line icons lifted from the mockup's rail (24x24, stroke currentColor). */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const EyeMark = ({ color = '#1E3A8A' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
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
