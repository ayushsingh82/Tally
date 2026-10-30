/** Mark: a blue badge with an F made of a wave, and an open ring where the trail ends. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Tally">
      <rect width="40" height="40" rx="10" fill="#2563eb" />
      <text x="20" y="29.5" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="27" fill="#ffffff">F</text>
      <circle cx="32" cy="8.5" r="3.2" fill="none" stroke="#ffffff" strokeWidth="1.8" />
    </svg>
  );
}
