import * as React from "react";
import { useTranslation } from "react-i18next";
import { getCookie } from "tiny-cookie";
import styled from "styled-components";
import type { Config } from "~/stores/AuthStore";
import Button from "~/components/Button";
import AuthenticationProvider from "~/scenes/Login/components/AuthenticationProvider";
import { vaultTheme } from "../theme";
import { WorkspaceFinder } from "./WorkspaceFinder";

const Copy = styled.div`
  h1 {
    margin: 0;
    font-family: ${vaultTheme.fontDisplay};
    font-size: clamp(30px, 3.6vw, 44px);
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: ${vaultTheme.navy800};
  }

  .sub {
    margin: 14px 0 30px;
    max-width: 44ch;
    font-size: 15.5px;
    line-height: 1.6;
    color: ${vaultTheme.muted};
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 10px;

    /* Provider buttons render as left-aligned rows, not centered pills. */
    button {
      justify-content: flex-start;
      text-align: left;
    }
  }

  .sent {
    margin: 12px 0 0;
    font-size: 13px;
    color: ${vaultTheme.muted};
  }

  .foot-line {
    margin-top: 22px;
    font-size: 13px;
    color: ${vaultTheme.muted};

    a {
      color: ${vaultTheme.navy};
      font-weight: 700;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
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
 * The Launchpad sign-in column: headline, provider rows, email step and the
 * workspace finder, in the Paper and Ink editorial layout.
 *
 * @returns The column element.
 */
export function AuthCard({ config }: Props) {
  const { t } = useTranslation();
  const [emailSentTo, setEmailSentTo] = React.useState("");
  const hints = React.useMemo(() => readSessionHints(), []);
  const lastHint = Object.values(hints)[0];

  return (
    <Copy>
      <h1>{t("Sign in to TIN Vault.")}</h1>
      <p className="sub">
        {t(
          "One identity for every team and client workspace. Your memberships decide where you can go."
        )}
      </p>

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

      <p className="foot-line">
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
    </Copy>
  );
}
