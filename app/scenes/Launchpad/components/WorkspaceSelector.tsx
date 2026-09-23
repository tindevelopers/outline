import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { stringToColor } from "@shared/utils/color";
import type { VaultWorkspace } from "~/hooks/useVaultWorkspaces";
import { requestVaultTransfer, signOutOfVault } from "~/hooks/useVaultWorkspaces";
import { vaultTheme } from "../theme";

const Copy = styled.div`
  h2 {
    margin: 0;
    font-family: ${vaultTheme.fontDisplay};
    font-size: 26px;
    letter-spacing: -0.02em;
    color: ${vaultTheme.navy800};
  }

  .lead {
    margin: 10px 0 0;
    max-width: 46ch;
    font-size: 14.5px;
    line-height: 1.6;
    color: ${vaultTheme.muted};
  }

  ul {
    margin: 26px 0 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid ${vaultTheme.line};
  }

  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 16px 6px;
    border: 0;
    border-bottom: 1px solid ${vaultTheme.line};
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-family: ${vaultTheme.fontDisplay};
    transition: background-color 0.16s ease;

    &:hover {
      background: rgba(53, 73, 107, 0.04);

      .arrow {
        transform: translateX(3px);
        color: ${vaultTheme.orange};
      }
    }

    &:active {
      transform: translateY(1px);
    }

    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
  }

  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: ${vaultTheme.radiusCtrl};
    font-weight: 800;
    font-size: 16px;
    color: #ffffff;
  }

  .meta {
    flex: 1;
    min-width: 0;
  }

  .name {
    display: block;
    font-size: 15px;
    font-weight: 700;
    color: ${vaultTheme.ink};
  }

  .slug {
    display: block;
    margin-top: 2px;
    font-family: ${vaultTheme.fontMono};
    font-size: 12px;
    color: ${vaultTheme.muted};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .arrow {
    flex: none;
    color: ${vaultTheme.muted};
    transition: transform 0.16s ease, color 0.16s ease;
  }

  .foot-line {
    margin-top: 22px;
    font-size: 13px;
    color: ${vaultTheme.muted};
  }

  .linkbtn {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: ${vaultTheme.navy};
    font-weight: 700;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }
`;

type Props = {
  /** The signed-in identity shown in the lead line. */
  email: string;
  /** The workspaces the identity is a member of. */
  workspaces: VaultWorkspace[];
};

/**
 * The authenticated workspace selector as divided rows: only the caller's
 * memberships, each entering its tenant through a transfer-token handoff.
 *
 * @returns The selector column.
 */
export function WorkspaceSelector({ email, workspaces }: Props) {
  const { t } = useTranslation();
  const [pending, setPending] = React.useState<string | null>(null);

  const handleChoose = async (workspace: VaultWorkspace) => {
    setPending(workspace.id);
    try {
      const url = await requestVaultTransfer(workspace.id);
      window.location.href = url;
    } catch (_err) {
      setPending(null);
    }
  };

  const handleSignOut = async () => {
    await signOutOfVault();
    window.location.reload();
  };

  return (
    <Copy>
      <h2>{t("Choose a workspace")}</h2>
      <p className="lead">
        {t(
          "Signed in as {{ email }}. Only workspaces where you hold membership appear here.",
          { email }
        )}
      </p>

      <ul>
        {workspaces.map((workspace) => (
          <li key={workspace.id}>
            <button
              className="row"
              type="button"
              disabled={pending !== null}
              onClick={() => void handleChoose(workspace)}
            >
              <span
                className="tile"
                style={{ background: stringToColor(workspace.id) }}
              >
                {workspace.name.charAt(0).toUpperCase()}
              </span>
              <span className="meta">
                <span className="name">{workspace.name}</span>
                <span className="slug">{workspace.slug}</span>
              </span>
              <svg
                className="arrow"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      <p className="foot-line">
        <button
          className="linkbtn"
          type="button"
          onClick={() => void handleSignOut()}
        >
          {t("Sign out")}
        </button>{" "}
        {t("or")}{" "}
        <button
          className="linkbtn"
          type="button"
          onClick={() => void handleSignOut()}
        >
          {t("switch account")}
        </button>
        .
      </p>
    </Copy>
  );
}
