import type { JSX, SVGAttributes } from 'preact';

type P = SVGAttributes<SVGSVGElement> & { size?: number };

const svg = (path: JSX.Element, viewBox = '0 0 24 24') =>
  function Icon({ size = 24, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox={viewBox} fill="currentColor" aria-hidden="true" {...rest}>
        {path}
      </svg>
    );
  };

export const PlayIcon = svg(<path d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.6-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />);
export const PauseIcon = svg(
  <>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </>,
);
export const BackIcon = svg(<path d="M15.5 4.5 8 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />);
export const MoreIcon = svg(
  <>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </>,
);
export const LockIcon = svg(<path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7zm2 0h6V7.5a3 3 0 0 0-6 0V10z" />);
export const CheckIcon = svg(<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />);
export const PlusIcon = svg(<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />);
export const ChevronDownIcon = svg(<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />);
export const MoonIcon = svg(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />);
export const RefreshIcon = svg(
  <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />,
);

export function SkipIcon({ seconds, forward, size = 34 }: { seconds: number; forward?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d={forward ? 'M16 5a11 11 0 1 1-11 11' : 'M16 5a11 11 0 1 0 11 11'}
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      />
      <path d={forward ? 'M16 1.5 20.5 5 16 8.5z' : 'M16 1.5 11.5 5 16 8.5z'} fill="currentColor" />
      <text x="16" y="20.5" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" font-family="-apple-system, system-ui, sans-serif">
        {seconds}
      </text>
    </svg>
  );
}

// Ikony do spodní lišty
export const TabListen = svg(<path d="M12 3a9 9 0 0 0-9 9v5.5A2.5 2.5 0 0 0 5.5 20H7a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H5v-1a7 7 0 0 1 14 0v1h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1.5a2.5 2.5 0 0 0 2.5-2.5V12a9 9 0 0 0-9-9z" />);
export const TabLibrary = svg(
  <>
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <rect x="13" y="3" width="8" height="8" rx="2" />
    <rect x="3" y="13" width="8" height="8" rx="2" />
    <rect x="13" y="13" width="8" height="8" rx="2" />
  </>,
);
export const TabSearch = svg(<path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.24 4.23a1 1 0 0 1-1.42 1.42l-4.23-4.24A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" />);
export const TabSettings = svg(
  <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 5-.03-.02.02-.98-.02-.98 1.9-1.5a.6.6 0 0 0 .14-.76l-1.8-3.12a.6.6 0 0 0-.73-.26l-2.24.9a7.6 7.6 0 0 0-1.7-.98l-.34-2.38A.6.6 0 0 0 15 3h-3.6a.6.6 0 0 0-.6.5l-.34 2.39c-.61.24-1.18.57-1.7.97l-2.24-.9a.6.6 0 0 0-.73.26L3.99 9.34a.6.6 0 0 0 .14.76L6.03 11.6a7.7 7.7 0 0 0 0 1.96l-1.9 1.5a.6.6 0 0 0-.14.76l1.8 3.12c.15.26.47.37.74.26l2.23-.9c.52.4 1.09.73 1.7.97l.34 2.39c.05.29.3.5.6.5H15c.3 0 .55-.21.6-.5l.34-2.39c.61-.24 1.18-.57 1.7-.97l2.23.9c.28.11.6 0 .74-.26l1.8-3.12a.6.6 0 0 0-.14-.76l-1.87-1.48z" />,
);
