/**
 * A single small inline SVG chair glyph, used by the seat map's cards, its
 * legend, and its bottom summary strip so a seat always reads as "a seat"
 * at a glance instead of a bare colored square. Deliberately simple line
 * art (no gradients/photo-style rendering) so it stays crisp at both the
 * tiny legend size and the larger per-seat card size, and its stroke color
 * is a plain prop so it always matches whatever status color it's drawn in.
 */
export default function ChairIcon({ color = 'currentColor', size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Backrest */}
      <path d="M6.5 3v8.5" stroke={color} strokeWidth="2.1" strokeLinecap="round" />
      <path d="M17.5 3v8.5" stroke={color} strokeWidth="2.1" strokeLinecap="round" />
      <path d="M6.5 3h11" stroke={color} strokeWidth="2.1" strokeLinecap="round" />
      {/* Seat */}
      <rect x="4.5" y="11.5" width="15" height="4" rx="1.2" fill={color} />
      {/* Legs */}
      <path d="M6 15.5 5 21M18 15.5 19 21" stroke={color} strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}
