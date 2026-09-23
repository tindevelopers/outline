import * as React from "react";
import styled, { ThemeProvider, useTheme } from "styled-components";
import type { DefaultTheme } from "styled-components";
import { useTranslation } from "react-i18next";
import type { Config } from "~/stores/AuthStore";
import { useVaultWorkspaces } from "~/hooks/useVaultWorkspaces";
import { vaultTheme } from "./theme";
import { AuthCard } from "./components/AuthCard";
import { BrandPanel } from "./components/BrandPanel";
import { VaultStatus } from "./components/VaultStatus";
import { WorkspaceSelector } from "./components/WorkspaceSelector";

// Two equal halves that always fill the viewport: navy brand panel, white
// sign-in side. They stack on narrow screens.
const Sheet = styled.main`
  min-height: 100dvh;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  background: #ffffff;
  font-family: ${vaultTheme.fontBody};

  @media (max-width: 940px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Side = styled.section`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 40px;
  padding: 48px 64px;
  color: ${vaultTheme.ink};

  .host {
    align-self: flex-end;
    font-family: ${vaultTheme.fontMono};
    font-size: 12.5px;
    color: ${vaultTheme.muted};
  }

  .column {
    width: 100%;
    max-width: 400px;
    align-self: center;
  }

  .access {
    margin: 0;
    font-size: 13px;
    color: ${vaultTheme.muted};

    a {
      color: ${vaultTheme.navy600};
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 3px;

      &:hover {
        color: ${vaultTheme.orange600};
      }
    }
  }

  @media (max-width: 940px) {
    padding: 28px 20px 40px;

    .host {
      display: none;
    }
  }
`;

const Skeleton = styled.div`
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  .skel {
    position: relative;
    overflow: hidden;
    background: rgba(53, 73, 107, 0.1);
    border-radius: 8px;
    height: 46px;

    &::after {
      content: "";
      position: absolute;
      inset: 0;
      transform: translateX(-100%);
      background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 255, 255, 0.55),
        transparent
      );
      animation: vault-shimmer 1.4s infinite;
    }
  }

  .skel.title {
    height: 40px;
    width: 60%;
  }

  @keyframes vault-shimmer {
    100% {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skel::after {
      animation: none;
    }
  }
`;

type Props = {
  /** The auth configuration returned for this host. */
  config: Config;
};

/**
 * The TIN Vault Launchpad: the apex authentication and workspace launch
 * experience in the Paper and Ink direction. Renders sign-in, the membership
 * selector, the single-workspace handoff and the terminal states.
 *
 * @returns The Launchpad scene.
 */
export function Launchpad({ config }: Props) {
  const { t } = useTranslation();
  const vault = useVaultWorkspaces();
  const theme = useTheme();

  // Buttons inside the Launchpad use the TIN orange at a shade that keeps
  // white label text at WCAG AA (4.5:1), unlike the decorative accent.
  const vaultAccentTheme: DefaultTheme = {
    ...theme,
    accent: vaultTheme.orange600,
    accentText: "#ffffff",
  };

  const host = config.hostname ?? window.location.host;

  let card: React.ReactNode;

  if (config.workspaceNotFound) {
    card = <VaultStatus kind="notfound" />;
  } else if (vault.status === "loading") {
    card = (
      <Skeleton aria-busy="true">
        <div className="skel title" />
        <div className="skel" />
        <div className="skel" />
        <div className="skel" />
      </Skeleton>
    );
  } else if (vault.status === "error") {
    card = <VaultStatus kind="error" />;
  } else if (vault.status === "ready") {
    if (vault.workspaces.length === 0) {
      card = (
        <VaultStatus
          kind="noaccess"
          email={vault.email}
          accessEmail={config.accessEmail}
        />
      );
    } else if (vault.workspaces.length === 1) {
      card = <VaultStatus kind="redirect" workspace={vault.workspaces[0]} />;
    } else {
      card = (
        <WorkspaceSelector email={vault.email} workspaces={vault.workspaces} />
      );
    }
  } else {
    card = <AuthCard config={config} />;
  }

  return (
    <ThemeProvider theme={vaultAccentTheme}>
      <Sheet>
        <BrandPanel />
        <Side>
          <span className="host" aria-label={t("Current host")}>
            {host}
          </span>
          <div className="column">{card}</div>
          <p className="access">
            {config.accessEmail ? (
              <>
                {t("Need access?")}{" "}
                <a href={`mailto:${config.accessEmail}`}>
                  {t("Contact your TIN administrator")}
                </a>
                .
              </>
            ) : (
              t("Need access? Contact your TIN administrator.")
            )}
          </p>
        </Side>
      </Sheet>
    </ThemeProvider>
  );
}

export default Launchpad;
