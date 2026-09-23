import * as React from "react";
import styled, { ThemeProvider, useTheme } from "styled-components";
import type { DefaultTheme } from "styled-components";
import { useTranslation } from "react-i18next";
import type { Config } from "~/stores/AuthStore";
import { useVaultWorkspaces } from "~/hooks/useVaultWorkspaces";
import { vaultTheme } from "./theme";
import { AuthCard } from "./components/AuthCard";
import { DocArt } from "./components/DocArt";
import { TopBar } from "./components/TopBar";
import { VaultStatus } from "./components/VaultStatus";
import { WorkspaceSelector } from "./components/WorkspaceSelector";

const Sheet = styled.main`
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #ffffff 0%, ${vaultTheme.bg} 340px);
  font-family: ${vaultTheme.fontDisplay};
`;

const Main = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 560px) minmax(0, 1fr);
  gap: 48px;
  align-items: center;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 12px 48px 120px;

  @media (max-width: 940px) {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 4px 20px 120px;
  }
`;

const Foot = styled.footer`
  border-top: 1px solid ${vaultTheme.line};
  padding: 18px 48px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 12.5px;
  color: ${vaultTheme.muted};

  .host {
    font-family: ${vaultTheme.fontMono};
  }

  @media (max-width: 940px) {
    padding: 18px 20px;
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
        <TopBar host={host} />
        <Main>
          <div>{card}</div>
          <DocArt />
        </Main>
        <Foot>
          <span>
            {t("Tenant-isolated workspaces. Single sign-on. Audited access.")}
          </span>
          <span className="host">{host}</span>
        </Foot>
      </Sheet>
    </ThemeProvider>
  );
}

export default Launchpad;
