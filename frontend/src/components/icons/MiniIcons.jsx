/** A handful of tiny inline-SVG glyphs shared by the seat map's due-date
 * rows, search box and summary strip — kept in one file since each is a
 * few lines and none is reused outside SeatMap.jsx. */

export function CalendarIcon({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" stroke={color} strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3M16 3v3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke={color} strokeWidth="1.8" />
      <path d="M20 20l-4.3-4.3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AlertIcon({ size = 20, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.3" r="1" fill={color} />
    </svg>
  );
}

export function ClockIcon({ size = 20, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BanIcon({ size = 20, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="1.8" />
      <path d="M6.5 6.5l11 11" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
