/**
 * The buni wordmark: rounded monoline letters, the i's dot an anchor point. Drawn in
 * currentColor.
 */
const LETTERS = "M0 110V260M0 210A50 50 0 1 0 100 210A50 50 0 1 0 0 210M140 160V210A50 50 0 0 0 240 210M240 160V260M280 260V160M280 210A50 50 0 0 1 380 210V260M420 160V260";

export function Wordmark({ height = 18 }: { height?: number }) {
  return (
    <svg className="wordmark" viewBox="-18 92 460 186" height={height} role="img" aria-label="buni">
      <path d={LETTERS} fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="404" y="98" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="7" />
    </svg>
  );
}

/** The wordmark's b alone, for places too small for the whole word. */
export function Mark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="-18 92 136 186" height={size} aria-hidden="true">
      <path d="M0 110V260M0 210A50 50 0 1 0 100 210A50 50 0 1 0 0 210" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" />
    </svg>
  );
}
