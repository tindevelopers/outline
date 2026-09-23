import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { getBaseDomain } from "@shared/utils/domains";
import Button from "~/components/Button";
import type { VaultWorkspace } from "~/hooks/useVaultWorkspaces";
import { requestVaultTransfer, signOutOfVault } from "~/hooks/useVaultWorkspaces";
import { vaultTheme } from "../theme";

const Card = styled.div`
  width: 100%;
  max-width: 432px;
  padding: 34px 34px 28px;
  background: ${vaultTheme.card};
  border: 1px solid ${vaultTheme.line};
  border-radius: ${vaultTheme.radiusSurface};
  box-shadow: ${vaultTheme.shadowCard};

  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    padding: 10px 4px;
  }

  h2 {
    margin: 0;
    font-family: ${vaultTheme.fontDisplay};
    font-size: 22px;
    letter-spacing: -0.02em;
    color: ${vaultTheme.ink};
  }

  p {
    margin: 0;
    max-width: 36ch;
    font-size: 14.5px;
    line-height: 1.6;
    color: ${vaultTheme.muted};
  }

  .mono {
    font-family: ${vaultTheme.fontMono};
    font-size: 12.5px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    margin-top: 8px;
  }

  .spin {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2.5px solid rgba(53, 73, 107, 0.18);
    border-top-color: ${vaultTheme.orange};
    animation: vault-spin 0.9s linear infinite;
  }

  @keyframes vault-spin {
    100% {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  @media (max-width: 880px) {
    padding: 26px 20px 22px;
  }
`;

type Props =
  | { kind: "redirect"; workspace: VaultWorkspace }
  | { kind: "noaccess"; email: string; accessEmail?: string }
  | { kind: "error" }
  | { kind: "notfound" };

/**
 * Terminal Launchpad states: single-workspace handoff, no membership,
 * provider failure and unknown tenant host.
 *
 * @returns The state card.
 */
export function VaultStatus(props: Props) {
  const { t } = useTranslation();
  const handoff = React.useRef<string | null>(null);

  const startHandoff = React.useCallback(async (workspace: VaultWorkspace) => {
    const url = await requestVaultTransfer(workspace.id);
    handoff.current = url;
    window.location.href = url;
  }, []);

  React.useEffect(() => {
    if (props.kind === "redirect") {
      void startHandoff(props.workspace);
    }
  }, [props, startHandoff]);

  const handleSignOut = async () => {
    await signOutOfVault();
    window.location.reload();
  };

  return (
    <Card>
      {props.kind === "redirect" ? (
        <div className="col">
          <div className="spin" role="status" aria-label={t("Redirecting")} />
          <h2>
            {t("Taking you to {{ name }}", { name: props.workspace.name })}
          </h2>
          <p className="mono">{props.workspace.slug}</p>
          <p>{t("Your only workspace. Signing you in now.")}</p>
          <div className="stack">
            <Button
              neutral
              onClick={() => {
                if (handoff.current) {
                  window.location.href = handoff.current;
                } else {
                  void startHandoff(props.workspace);
                }
              }}
            >
              {t("Continue manually")}
            </Button>
          </div>
        </div>
      ) : null}

      {props.kind === "noaccess" ? (
        <div className="col">
          <h2>{t("No workspaces yet")}</h2>
          <p>
            {t(
              "You are signed in as {{ email }}. That account is not a member of any TIN Vault workspace. A workspace administrator can grant access.",
              { email: props.email }
            )}
          </p>
          <div className="stack">
            {props.accessEmail ? (
              <Button
                onClick={() => {
                  window.location.href = `mailto:${props.accessEmail}`;
                }}
              >
                {t("Request access")}
              </Button>
            ) : null}
            <Button neutral onClick={() => void handleSignOut()}>
              {t("Sign out")}
            </Button>
          </div>
        </div>
      ) : null}

      {props.kind === "error" ? (
        <div className="col">
          <h2>{t("We could not complete that sign-in")}</h2>
          <p>
            {t(
              "The identity provider did not confirm your session. This is usually temporary and your credentials were not stored."
            )}
          </p>
          <div className="stack">
            <Button onClick={() => window.location.reload()}>
              {t("Try again")}
            </Button>
            <Button neutral onClick={() => void handleSignOut()}>
              {t("Contact support")}
            </Button>
          </div>
        </div>
      ) : null}

      {props.kind === "notfound" ? (
        <div className="col">
          <h2>{t("Workspace not found")}</h2>
          <p>
            {t(
              "We could not find a workspace at this address, or you do not have access to it. Use the Launchpad to reach your workspaces."
            )}
          </p>
          <div className="stack">
            <Button
              onClick={() => {
                const { protocol, port } = window.location;
                window.location.href = `${protocol}//${getBaseDomain()}${
                  port ? `:${port}` : ""
                }/`;
              }}
            >
              {t("Go to Launchpad")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
