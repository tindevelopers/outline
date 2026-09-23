import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { stringToColor } from "@shared/utils/color";
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

  h2 {
    margin: 0;
    font-family: ${vaultTheme.fontDisplay};
    font-size: 24px;
    letter-spacing: -0.02em;
    color: ${vaultTheme.ink};
  }

  .lead {
    margin: 8px 0 22px;
    font-size: 14.5px;
    line-height: 1.55;
    color: ${vaultTheme.muted};
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 12px 14px;
    border-radius: ${vaultTheme.radiusCtrl};
    border: 1px solid ${vaultTheme.line};
    background: ${vaultTheme.card};
    cursor: pointer;
    text-align: left;
    font-family: ${vaultTheme.fontDisplay};
    transition: border-color 0.16s ease, box-shadow 0.16s ease,
      transform 0.12s ease;

    &:hover {
      border-color: #c3cfdb;
      box-shadow: 0 3px 14px rgba(16, 32, 54, 0.1);

      .arrow {
        transform: translateX(3px);
        color: ${vaultTheme.orange};
      }
    }

    &:active {
      transform: translateY(1px);
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

  .foot {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid ${vaultTheme.line};
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
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

  @media (max-width: 880px) {
    padding: 26px 20px 22px;
  }
`;

type Props = {
  /** The signed-in identity shown in the lead line. */
  email: string;
  /** The workspaces the identity is a member of. */
  workspaces: VaultWorkspace[];
};

/**
 * The authenticated workspace selector: only the caller's memberships, each
 * entering its tenant through a transfer-token handoff.
 *
 * @returns The selector card.
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
    <Card>
      <h2>{t("Choose a workspace")}</h2>
      <p className="lead">
        {t("Signed in as {{ email }}. You are a member of these workspaces.", {
          email,
        })}
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
                style={{
                  background: workspace.avatarUrl
                    ? vaultTheme.navy
                    : stringToColor(workspace.id),
                }}
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

      <div className="foot">
        <button className="linkbtn" type="button" onClick={() => void handleSignOut()}>
          {t("Sign out")}
        </button>
        <button className="linkbtn" type="button" onClick={() => void handleSignOut()}>
          {t("Switch account")}
        </button>
      </div>
    </Card>
  );
}
