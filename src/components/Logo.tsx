import { useId } from "react";

/** Open LaTeX Compiler mark: the letters OLC knocked out of a rounded square. */
export function Logo({ size = 22 }: { size?: number }) {
  const mask = `olc-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Open LaTeX Compiler">
      <mask id={mask}>
        <rect width="32" height="32" fill="#fff" />
        <g fill="none" stroke="#000" strokeWidth="2.4">
          <ellipse cx="8" cy="16" rx="2.8" ry="4.3" />
          <path d="M15 10.5V20.3H19.2" />
          <path d="M26.87 12.8A2.8 4.3 0 1 0 26.87 19.2" />
        </g>
      </mask>
      <rect width="32" height="32" rx="8" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
}
