import * as React from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { vaultTheme } from "../theme";

const Mark = styled.span<{ $size: number }>`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: inherit;

  .tin-word {
    font-family: ${vaultTheme.fontDisplay};
    font-weight: 800;
    font-size: ${({ $size }) => Math.round($size * 0.48)}px;
    letter-spacing: -0.01em;
    line-height: 1;
  }

  .vault {
    font-weight: 700;
    letter-spacing: 0.22em;
    font-size: ${({ $size }) => Math.round($size * 0.33)}px;
    margin-left: 6px;
    vertical-align: 2px;
  }
`;

type Props = {
  /** Pixel height of the logomark. */
  size?: number;
  /** Whether to render the VAULT word next to the mark. */
  withWord?: boolean;
};

/**
 * The TIN logomark: navy letterforms with the orange signal arcs, drawn as
 * inline SVG so it inherits the surrounding text color.
 *
 * @returns The lockup element.
 */
export function TinMark({ size = 30, withWord = true }: Props) {
  const { t } = useTranslation();
  const width = Math.round(size * 1.55);

  return (
    <Mark $size={size}>
      <svg
        width={width}
        height={size}
        viewBox="0 0 170 110"
        fill="none"
        aria-hidden="true"
      >
        <g
          stroke="currentColor"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M32 28 V86 Q32 100 46 100 H54" />
          <path d="M20 52 H56" />
          <path d="M85 62 V100" />
          <path d="M118 100 V74 Q118 60 133 60 Q150 60 150 76 V100" />
        </g>
        <circle cx="85" cy="42" r="9" fill={vaultTheme.orange} />
        <g
          stroke={vaultTheme.orange}
          strokeWidth="7"
          strokeLinecap="round"
        >
          <path d="M89.1 26.5 A16 16 0 0 1 100.5 37.9" />
          <path d="M91.7 16.8 A26 26 0 0 1 110.2 35.3" />
          <path d="M94.3 7.1 A36 36 0 0 1 119.9 32.6" />
        </g>
      </svg>
      {withWord ? (
        <span className="tin-word">
          tin<span className="vault">{t("VAULT")}</span>
        </span>
      ) : null}
    </Mark>
  );
}
