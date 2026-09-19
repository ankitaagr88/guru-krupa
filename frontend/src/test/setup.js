import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// virtual:pwa-register only exists inside the Vite build.
vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => {} }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = '';
});

// jsdom has no matchMedia
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}
