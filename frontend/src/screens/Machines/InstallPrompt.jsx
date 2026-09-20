import { useEffect, useState } from 'react';

const DISMISS_KEY = 'gk_install_dismissed';

/* Small "Install app" chip (task F5: PWA install prompt). Chrome/Android fire
   `beforeinstallprompt`; we hold the event and show it on the Machines header,
   the screen the technician uses on the phone. Hidden once installed
   (`display-mode: standalone` / `appinstalled`) or after a dismiss (session). */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const standalone =
      (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
    if (standalone) setInstalled(true);
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || dismissed || !deferred) return null;

  const install = async () => {
    try {
      deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === 'accepted') setInstalled(true);
    } catch {
      /* ignore */
    }
    setDeferred(null);
  };
  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="install-prompt" role="status" data-testid="install-prompt">
      <span>Install Guru Krupa on this phone for camera and offline capture</span>
      <button type="button" onClick={install}>
        Install
      </button>
      <button type="button" className="dismiss" onClick={dismiss} aria-label="Not now">
        ✕
      </button>
    </div>
  );
}
