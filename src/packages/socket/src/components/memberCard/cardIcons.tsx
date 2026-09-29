/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";

/** The card's own line icons, drawn the way the mockup draws them. */
function I({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const CardIcon = {
  chat: () => <I><path d="M4 5h16v11H9l-5 4z" /></I>,
  friend: () => (
    <I>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 20c1-4 4-6 7-6s6 2 7 6" />
      <path d="M19 8v6M16 11h6" />
    </I>
  ),
  clock: () => (
    <I>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </I>
  ),
  check: () => <I><path d="M5 12l5 5 9-10" /></I>,
  close: () => <I><path d="M6 6l12 12M18 6L6 18" /></I>,
  at: () => (
    <I>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-4 7.5" />
    </I>
  ),
  copy: () => (
    <I>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </I>
  ),
  flag: () => (
    <I>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </I>
  ),
  more: () => (
    <I>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </I>
  ),
  pen: () => (
    <I>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </I>
  ),
  mic: () => (
    <I>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 12 5M12 18v3" />
      <path d="M3 3l18 18" />
    </I>
  ),
  deaf: () => (
    <I>
      <path d="M4 15v-3a8 8 0 0 1 14-5.3M20 12v3" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
      <path d="M3 3l18 18" />
    </I>
  ),
  disc: () => <I><path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V16l-3 1.5z" /></I>,
  kick: () => (
    <I>
      <path d="M14 4h5v16h-5" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </I>
  ),
  ban: () => (
    <I>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </I>
  ),
  roles: () => <I><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></I>,
  pad: () => (
    <I>
      <path d="M7 8h10a4 4 0 0 1 4 4l.6 4a2.5 2.5 0 0 1-4.4 1.9L15 15H9l-2.2 2.9A2.5 2.5 0 0 1 2.4 16L3 12a4 4 0 0 1 4-4z" />
      <path d="M7 11v3M5.5 12.5h3" />
      <circle cx="16" cy="11.5" r=".6" />
      <circle cx="18" cy="13.5" r=".6" />
    </I>
  ),
  caret: () => (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};
