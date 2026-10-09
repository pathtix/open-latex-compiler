/** latexcompile mark: a light ray entering a prism and fanning out. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="latexcompile">
      <path d="M16 4.5 28 26H4L16 4.5Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M2 15.5h9.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M17.8 15.8 30 11.5M18.2 17.2 30 17.2M17.8 18.6 30 23" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".75" />
    </svg>
  );
}
