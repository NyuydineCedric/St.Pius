// Minimal brand glyphs for Facebook and TikTok — lucide-react intentionally
// doesn't ship brand/logo icons, so these are small hand-drawn SVGs sized
// and styled to sit next to lucide icons (pass className the same way).

export function FacebookIcon({ className = "", size = 20 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M22 12.06C22 6.51 17.52 2 12 2S2 6.51 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.27c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34v7.03c4.78-.76 8.44-4.92 8.44-9.94Z" />
    </svg>
  );
}

export function TikTokIcon({ className = "", size = 20 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M16.6 5.82a4.28 4.28 0 0 1-3.14-1.35 4.29 4.29 0 0 1-1.14-2.93h-3.02v13.44a2.6 2.6 0 1 1-1.86-2.49v-3.09a5.6 5.6 0 1 0 4.88 5.56V9.4a7.26 7.26 0 0 0 4.28 1.38V7.76a4.36 4.36 0 0 1 0-1.94Z" />
    </svg>
  );
}
