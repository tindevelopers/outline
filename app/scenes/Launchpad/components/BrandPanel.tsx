import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { vaultTheme } from "../theme";
import { TinMark } from "./TinMark";

const Panel = styled.section`
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 40px 48px;
  background: linear-gradient(
    160deg,
    ${vaultTheme.navy700},
    ${vaultTheme.navy900} 70%
  );
  color: ${vaultTheme.inkDark};

  h1 {
    margin: 0;
    font-family: ${vaultTheme.fontDisplay};
    font-size: clamp(30px, 3.2vw, 42px);
    line-height: 1.12;
    letter-spacing: -0.02em;
    max-width: 12ch;
  }

  p.sub {
    margin: 14px 0 0;
    max-width: 34ch;
    font-size: 15px;
    line-height: 1.6;
    color: ${vaultTheme.mutedDark};
  }

  .micro {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: ${vaultTheme.mutedDark};

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${vaultTheme.orange};
    }
  }

  .arcs {
    position: absolute;
    right: -140px;
    bottom: -120px;
    width: 560px;
    opacity: 0.14;
    pointer-events: none;
  }

  @media (max-width: 880px) {
    padding: 28px 24px 32px;

    h1 {
      font-size: 26px;
      max-width: 16ch;
    }

    .micro {
      display: none;
    }
  }
`;

/**
 * The left brand panel of the Launchpad: identity, one promise, one
 * orientation line. No marketing content.
 *
 * @returns The panel element.
 */
export function BrandPanel() {
  const { t } = useTranslation();

  return (
    <Panel>
      <svg className="arcs" viewBox="0 0 400 400" fill="none" aria-hidden="true">
        <g stroke={vaultTheme.orange} strokeWidth="10" strokeLinecap="round">
          <path d="M120 200 A80 80 0 0 1 200 280" />
          <path d="M120 140 A140 140 0 0 1 260 280" />
          <path d="M120 80 A200 200 0 0 1 320 280" />
          <path d="M120 20 A260 260 0 0 1 380 280" />
        </g>
      </svg>

      <TinMark size={30} />

      <div>
        <h1>{t("One door to every workspace.")}</h1>
        <p className="sub">
          {t(
            "TIN Vault keeps each team and client in its own isolated workspace. Sign in once and we take you to the ones you belong to."
          )}
        </p>
      </div>

      <p className="micro">
        <span className="dot" />
        {t("docs.tin.info, the single entry point for all TIN knowledge")}
      </p>
    </Panel>
  );
}
