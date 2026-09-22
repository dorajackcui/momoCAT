import type { SVGProps } from 'react';

// Shared Lucide shapes: https://lucide.dev
// License and Feather attribution: renderer/public/licenses/LUCIDE.txt.
const shapes = {
  check: <path d="M5 13l4 4L19 7" />,
  'shield-alert': (
    <>
      <path d="M12 3 4 7v5c0 5 8 9 8 9s8-4 8-9V7l-8-4ZM12 8v5" />
      <path d="M12 16h.01" />
    </>
  ),
  'chevrons-right': <path d="m13 5 7 7-7 7M5 5l7 7-7 7" />,
  eraser: (
    <path d="m16 3 5 5a2 2 0 0 1 0 3L11 21H6l-4-4a2 2 0 0 1 0-3L13 3a2 2 0 0 1 3 0ZM8 8l8 8M11 21h11" />
  ),
  'file-spreadsheet': (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5M8 13h2M14 13h2M8 17h2M14 17h2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5M3 12A9 3 0 0 0 21 12" />
    </>
  ),
  'book-open': (
    <>
      <path d="M12 5v16" />
      <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
    </>
  ),
  'settings-2': (
    <>
      <path d="M14 17H5M19 7h-9" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  funnel: (
    <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
  ),
};

export function Icon({
  name,
  className = 'h-4 w-4 shrink-0',
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof shapes }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {shapes[name]}
    </svg>
  );
}
