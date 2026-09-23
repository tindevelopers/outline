import * as React from "react";
import { useTranslation } from "react-i18next";
import { getCookie } from "tiny-cookie";
import styled from "styled-components";
import type { Config } from "~/stores/AuthStore";
import Button from "~/components/Button";
import AuthenticationProvider from "~/scenes/Login/components/AuthenticationProvider";
import { Notices } from "~/scenes/Login/components/Notices";
import { vaultTheme } from "../theme";
import { WorkspaceFinder } from "./WorkspaceFinder";

const Copy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 28px;

  .intro {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-family: ${vaultTheme.fontDisplay};
    font-weight: 800;
    font-size: 32px;
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: ${vaultTheme.navy800};
  }

  .sub {
    margin: 0;
    font-size: 15px;
    line-height: 1.55;
    color: ${vaultTheme.muted};
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 10px;

    button {
      height: 48px;
      justify-content: center;
    }
  }

  .sent {
    margin: 0;
    font-size: 13px;
    color: ${vaultTheme.muted};
  }
`;

type Sessions = Record<string, { name: string; logoUrl: string; url: string }>;

/**
 * Reads the base-domain sessions hint cookie written at tenant sign-in.
 *
 * @returns The hinted sessions, empty when absent or unreadable.
 */
function readSessionHints(): Sessions {
  try {
    return JSON.parse(getCookie("sessions") || "{}") as Sessions;
  } catch (_err) {
    return {};
  }
}

type Props = {
  /** The auth configuration for the apex host. */
  config: Config;
};

/**
 * The Launchpad sign-in column: one primary provider, the rest secondary,
 * then the workspace finder.
 *
 * @returns The column element.
 */
export function AuthCard({ config }: Props) {
  const { t } = useTranslation();
  const [emailSentTo, setEmailSentTo] = React.useState("");
  const hints = React.useMemo(() => readSessionHints(), []);
  const lastHint = Object.values(hints)[0];

  // Microsoft is TIN's primary identity provider; one solid button keeps the
  // hierarchy clear instead of several competing ones.
  const primaryId = config.providers.some((p) => p.id === "azure")
    ? "azure"
    : config.providers[0]?.id;

  return (
    <Copy>
      <div className="intro">
        <h1>{t("Sign in to TIN Vault")}</h1>
        <p className="sub">
          {t(
            "Use your work account. We'll show you only the workspaces you belong to."
          )}
        </p>
      </div>

      <Notices />

      <div className="rows">
        {lastHint ? (
          <Button
            neutral
            style={{ width: "100%" }}
            onClick={() => {
              window.location.href = lastHint.url;
            }}
          >
            {t("Continue to {{ name }}", { name: lastHint.name })}
          </Button>
        ) : null}
        {config.providers.map((provider) => (
          <AuthenticationProvider
            key={provider.id}
            id={provider.id}
            name={provider.name}
            authUrl={provider.authUrl}
            isCreate={false}
            preferOTP={false}
            neutral={provider.id !== primaryId}
            onEmailSuccess={(email) => setEmailSentTo(email)}
          />
        ))}
      </div>

      {config.providers.length === 0 ? (
        <p className="sent">
          {t("No sign-in methods are configured for this installation yet.")}
        </p>
      ) : null}

      {emailSentTo ? (
        <p className="sent">
          {t("A sign-in link is on its way to {{ email }}.", {
            email: emailSentTo,
          })}
        </p>
      ) : null}

      <WorkspaceFinder title={t("Know your workspace?")} />
    </Copy>
  );
}
