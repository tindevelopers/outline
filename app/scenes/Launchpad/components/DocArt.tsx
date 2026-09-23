import * as React from "react";
import styled from "styled-components";
import { vaultTheme } from "../theme";

const Art = styled.div`
  display: flex;
  justify-content: center;

  svg {
    width: min(460px, 100%);
    height: auto;
  }

  @media (max-width: 940px) {
    display: none;
  }
`;

/**
 * The document-stack illustration: three offset pages in paper tones with a
 * single orange confirmation seal. Decorative only.
 *
 * @returns The illustration element.
 */
export function DocArt() {
  return (
    <Art aria-hidden="true">
      <svg viewBox="0 0 460 420" fill="none">
        <rect
          x="70"
          y="60"
          width="280"
          height="330"
          rx="14"
          fill="#ffffff"
          stroke={vaultTheme.line}
        />
        <rect x="100" y="104" width="150" height="12" rx="6" fill={vaultTheme.navy} opacity="0.85" />
        <rect x="100" y="136" width="220" height="8" rx="4" fill="#c9d4df" />
        <rect x="100" y="156" width="200" height="8" rx="4" fill="#c9d4df" />
        <rect x="100" y="176" width="210" height="8" rx="4" fill="#c9d4df" />
        <rect x="100" y="216" width="90" height="8" rx="4" fill={vaultTheme.orange} opacity="0.85" />
        <rect x="100" y="244" width="220" height="8" rx="4" fill={vaultTheme.line} />
        <rect x="100" y="264" width="180" height="8" rx="4" fill={vaultTheme.line} />
        <rect
          x="120"
          y="26"
          width="280"
          height="330"
          rx="14"
          fill={vaultTheme.bg}
          stroke={vaultTheme.line}
        />
        <rect x="150" y="70" width="130" height="12" rx="6" fill={vaultTheme.navy} opacity="0.55" />
        <rect x="150" y="102" width="200" height="8" rx="4" fill="#d7dfe7" />
        <rect x="150" y="122" width="180" height="8" rx="4" fill="#d7dfe7" />
        <rect
          x="170"
          y="-6"
          width="280"
          height="330"
          rx="14"
          fill="#ffffff"
          stroke={vaultTheme.line}
        />
        <rect x="200" y="38" width="120" height="12" rx="6" fill={vaultTheme.navy} opacity="0.35" />
        <rect x="200" y="70" width="190" height="8" rx="4" fill={vaultTheme.line} />
        <rect x="200" y="90" width="170" height="8" rx="4" fill={vaultTheme.line} />
        <circle cx="404" cy="352" r="34" fill={vaultTheme.orange} />
        <path
          d="M392 352 l8 9 l16 -18"
          stroke="#ffffff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Art>
  );
}
