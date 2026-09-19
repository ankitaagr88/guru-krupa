import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;

/** Reads `?device=mobile|desktop` from the URL (testing override, like the
 *  mockup's device toggle). Persisted in sessionStorage so it survives
 *  in-app navigation. Returns null when no override is set. */
export function getDeviceOverride() {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('device');
    if (q === 'mobile' || q === 'desktop') {
      sessionStorage.setItem('gk_device', q);
      return q;
    }
    if (q === 'auto') {
      sessionStorage.removeItem('gk_device');
      return null;
    }
    const stored = sessionStorage.getItem('gk_device');
    return stored === 'mobile' || stored === 'desktop' ? stored : null;
  } catch {
    return null;
  }
}

export function computeDeviceMode() {
  const override = getDeviceOverride();
  if (override) return override;
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
}

/** `setDeviceMode` from the mockup as a hook: returns 'mobile' | 'desktop',
 *  and mirrors it onto <body class="mobile-mode"> so the ported CSS applies. */
export function useDeviceMode() {
  const [mode, setMode] = useState(computeDeviceMode);

  useEffect(() => {
    const onResize = () => setMode(computeDeviceMode());
    window.addEventListener('resize', onResize);
    window.addEventListener('popstate', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('popstate', onResize);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('mobile-mode', mode === 'mobile');
    return () => document.body.classList.remove('mobile-mode');
  }, [mode]);

  return mode;
}
