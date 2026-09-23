import * as React from "react";
import styled, { ThemeProvider, useTheme } from "styled-components";
import type { DefaultTheme } from "styled-components";
import type { Config } from "~/stores/AuthStore";
import { useVaultWorkspaces } from "~/hooks/useVaultWorkspaces";
import { vaultTheme } from "./theme";
import { AuthCard } from "./components/AuthCard";
import { BrandPanel } from "./components/BrandPanel";
import { VaultStatus } from "./components/VaultStatus";
import { WorkspaceSelector } from "./components/WorkspaceSelector";

const Shell = styled.main`
  display: grid;
  grid-template-columns: minmax(380px, 44fr) 56fr;
  min-height: 100dvh;
  background: ${vaultTheme.bg};
  font-family: ${vaultTheme.fontDisplay};

  @media (max-width: 880px) {
    grid-template-columns: 1fr;
  }
`;

const Pane = styled.section`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px 96px;

  @media (max-width: 880px) {
    padding: 32px 16px 110px;
  }
`;

const SkeletonCard = styled.div`
  width: 100%;
  max-width: 432px;
  padding: 34px;
  background: ${vaultTheme.card};
  border: 1px solid ${vaultTheme.line};
  border-radius: ${vaultTheme.radiusSurface};
  box-shadow: ${vaultTheme.shadowCard};
  display: flex;
  flex-direction: column;
  gap: 12px;

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
    height: 24px;
    width: 40%;
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
 * experience. Renders sign-in, the membership selector, the single-workspace
 * handoff and the terminal states.
 *
 * @returns The Launchpad scene.
 */
export function Launchpad({ config }: Props) {
  const vault = useVaultWorkspaces();
  const theme = useTheme();

  // Buttons inside the Launchpad use the TIN orange at a shade that keeps
  // white label text at WCAG AA (4.5:1), unlike the decorative accent.
  const vaultAccentTheme: DefaultTheme = {
    ...theme,
    accent: vaultTheme.orange600,
    accentText: "#ffffff",
  };

  let card: React.ReactNode;

  if (config.workspaceNotFound) {
    card = <VaultStatus kind="notfound" />;
  } else if (vault.status === "loading") {
    card = (
      <SkeletonCard aria-busy="true">
        <div className="skel title" />
        <div className="skel" />
        <div className="skel" />
        <div className="skel" />
      </SkeletonCard>
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
      card = (
        <VaultStatus kind="redirect" workspace={vault.workspaces[0]} />
      );
    } else {
      card = (
        <WorkspaceSelector
          email={vault.email}
          workspaces={vault.workspaces}
        />
      );
    }
  } else {
    card = <AuthCard config={config} />;
  }

  return (
    <ThemeProvider theme={vaultAccentTheme}>
      <Shell>
        <BrandPanel />
        <Pane>{card}</Pane>
      </Shell>
    </ThemeProvider>
  );
}

export default Launchpad;
