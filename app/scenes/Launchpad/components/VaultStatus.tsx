import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { getBaseDomain } from "@shared/utils/domains";
import Button from "~/components/Button";
import type { VaultWorkspace } from "~/hooks/useVaultWorkspaces";
import {
  requestVaultTransfer,
  signOutOfVault,
} from "~/hooks/useVaultWorkspaces";
import { vaultTheme } from "../theme";

const Copy = styled.div`
  h2 {
    margin: 0;
    font-family: ${vaultTheme.fontDisplay};
    font-size: 26px;
    letter-spacing: -0.02em;
    color: ${vaultTheme.navy800};
  }

  p.lead {
    margin: 10px 0 0;
    max-width: 46ch;
    font-size: 14.5px;
    line-height: 1.6;
    color: ${vaultTheme.muted};
  }

  p.lead.mono {
    font-family: ${vaultTheme.fontMono};
    font-size: 12.5px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    margin-top: 22px;
    max-width: 320px;
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
`;

type Props =
  | { kind: "redirect"; workspace: VaultWorkspace }
  | { kind: "noaccess"; email: string; accessEmail?: string }
  | { kind: "error" }
  | { kind: "notfound" };

/**
 * Terminal Launchpad states in the Paper and Ink layout: single-workspace
 * handoff, no membership, provider failure and unknown tenant host.
 *
 * @returns The state column.
 */
export function VaultStatus(props: Props) {
  const { t } = useTranslation();
  const handoff = React.useRef<string | null>(null);
  const [handoffFailed, setHandoffFailed] = React.useState(false);

  const startHandoff = React.useCallback(async (workspace: VaultWorkspace) => {
    try {
      const url = await requestVaultTransfer(workspace.id);
      handoff.current = url;
      window.location.href = url;
    } catch (_err) {
      setHandoffFailed(true);
    }
  }, []);

  // Keyed on the workspace id rather than the props object, which is new on
  // every render and would re-request a transfer token each time.
  const redirectWorkspaceId =
    props.kind === "redirect" ? props.workspace.id : undefined;

  React.useEffect(() => {
    if (props.kind === "redirect") {
      void startHandoff(props.workspace);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirectWorkspaceId, startHandoff]);

  const handleSignOut = async () => {
    await signOutOfVault();
    window.location.reload();
  };

  return (
    <Copy>
      {props.kind === "redirect" ? (
        <>
          <h2>
            {t("Taking you to {{ name }}", { name: props.workspace.name })}
          </h2>
          <p className="lead mono">{props.workspace.slug}</p>
          <p className="lead" role={handoffFailed ? "alert" : undefined}>
            {handoffFailed
              ? t("We could not open it automatically. Try again below.")
              : t("Your only workspace. Signing you in now.")}
          </p>
          <div className="stack">
            {handoffFailed ? null : (
              <div
                className="spin"
                role="status"
                aria-label={t("Redirecting")}
              />
            )}
            <Button
              neutral
              onClick={() => {
                if (handoff.current) {
                  window.location.href = handoff.current;
                } else {
                  setHandoffFailed(false);
                  void startHandoff(props.workspace);
                }
              }}
            >
              {t("Continue manually")}
            </Button>
          </div>
        </>
      ) : null}

      {props.kind === "noaccess" ? (
        <>
          <h2>{t("No workspaces yet")}</h2>
          <p className="lead">
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
        </>
      ) : null}

      {props.kind === "error" ? (
        <>
          <h2>{t("We could not complete that sign-in")}</h2>
          <p className="lead">
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
        </>
      ) : null}

      {props.kind === "notfound" ? (
        <>
          <h2>{t("Workspace not found")}</h2>
          <p className="lead">
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
        </>
      ) : null}
    </Copy>
  );
}
