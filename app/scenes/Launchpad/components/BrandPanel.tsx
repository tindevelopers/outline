import { useTranslation } from "react-i18next";
import styled, { keyframes } from "styled-components";
import { vaultTheme } from "../theme";
import { TinMark } from "./TinMark";

const ripple = keyframes`
  0% { transform: scale(0.08); opacity: 0; }
  12% { opacity: 0.5; }
  100% { transform: scale(1); opacity: 0; }
`;

const breathe = keyframes`
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
`;

const Panel = styled.section`
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 48px;
  padding: 48px 56px;
  background: ${vaultTheme.navy800};
  color: #ffffff;

  .art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .ripple {
    transform-box: fill-box;
    transform-origin: center;
    opacity: 0;
    animation: ${ripple} 12s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
  }

  .ripple.r2 {
    animation-delay: 4s;
  }

  .ripple.r3 {
    animation-delay: 8s;
  }

  .source {
    animation: ${breathe} 4s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .ripple {
      animation: none;
      opacity: 0.14;
      transform: scale(0.55);
    }
    .ripple.r2 {
      transform: scale(0.8);
    }
    .ripple.r3 {
      opacity: 0;
    }
    .source {
      animation: none;
      opacity: 1;
    }
  }

  .top,
  .copy,
  .trust {
    position: relative;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .vault {
    font-family: ${vaultTheme.fontMono};
    font-size: 12px;
    letter-spacing: 0.24em;
    color: #b7c3d3;
  }

  .copy {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .eyebrow {
    font-family: ${vaultTheme.fontMono};
    font-size: 12px;
    letter-spacing: 0.18em;
    color: #f0a07e;
  }

  h2 {
    margin: 0;
    font-family: ${vaultTheme.fontDisplay};
    font-weight: 800;
    font-size: clamp(36px, 4vw, 54px);
    line-height: 1.04;
    letter-spacing: -0.03em;
  }

  p {
    margin: 0;
    max-width: 38ch;
    font-family: ${vaultTheme.fontBody};
    font-size: 16px;
    line-height: 1.6;
    color: #b7c3d3;
  }

  .trust {
    font-family: ${vaultTheme.fontMono};
    font-size: 11.5px;
    letter-spacing: 0.08em;
    color: #8d9bb0;
    text-transform: uppercase;
  }

  @media (max-width: 940px) {
    gap: 28px;
    padding: 28px 20px 32px;

    .trust {
      display: none;
    }
  }
`;

/**
 * The navy half of the Launchpad: TIN identity, the vault promise, and a
 * slow signal pulse behind them.
 *
 * @returns The brand panel element.
 */
export function BrandPanel() {
  const { t } = useTranslation();

  return (
    <Panel>
      <svg
        className="art"
        viewBox="0 0 560 800"
        preserveAspectRatio="xMaxYMax slice"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="vault-dots"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1" fill="#ffffff" fillOpacity="0.07" />
          </pattern>
        </defs>
        <rect width="560" height="800" fill="url(#vault-dots)" />
        <circle
          className="ripple"
          cx="470"
          cy="690"
          r="560"
          stroke="#ffffff"
          strokeWidth="1.2"
        />
        <circle
          className="ripple r2"
          cx="470"
          cy="690"
          r="560"
          stroke={vaultTheme.orange}
          strokeWidth="1.2"
        />
        <circle
          className="ripple r3"
          cx="470"
          cy="690"
          r="560"
          stroke="#ffffff"
          strokeWidth="1.2"
        />
        <circle
          cx="470"
          cy="690"
          r="18"
          stroke={vaultTheme.orange}
          strokeOpacity="0.35"
          strokeWidth="1"
        />
        <circle
          className="source"
          cx="470"
          cy="690"
          r="5"
          fill={vaultTheme.orange}
        />
      </svg>

      <div className="top">
        <TinMark size={64} />
        <span className="vault">VAULT</span>
      </div>

      <div className="copy">
        <span className="eyebrow">{t("THE INTELLIGENT NETWORK")}</span>
        <h2>
          {t("One identity.")}
          <br />
          {t("Every workspace.")}
        </h2>
        <p>
          {t(
            "Your memberships decide where you can go. Nothing else is listed, suggested or searched."
          )}
        </p>
      </div>

      <span className="trust">
        {t("Tenant-isolated · Single sign-on · Audited access")}
      </span>
    </Panel>
  );
}
