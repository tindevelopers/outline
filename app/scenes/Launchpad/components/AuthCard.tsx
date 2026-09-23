import * as React from "react";
import { useTranslation } from "react-i18next";
import { getCookie } from "tiny-cookie";
import styled from "styled-components";
import type { Config } from "~/stores/AuthStore";
import Button from "~/components/Button";
import AuthenticationProvider from "~/scenes/Login/components/AuthenticationProvider";
import { vaultTheme } from "../theme";
import { WorkspaceFinder } from "./WorkspaceFinder";

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

  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 18px 0;
    color: ${vaultTheme.muted};
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;

    &::before,
    &::after {
      content: "";
      flex: 1;
      height: 1px;
      background: ${vaultTheme.line};
    }
  }

  .foot {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid ${vaultTheme.line};
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

  .sent {
    margin: 10px 0 0;
    font-size: 13px;
    color: ${vaultTheme.muted};
  }

  @media (max-width: 880px) {
    padding: 26px 20px 22px;
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
 * The authenticated-entry card: provider buttons, email step, the workspace
 * finder and the returning-visitor shortcut.
 *
 * @returns The card element.
 */
export function AuthCard({ config }: Props) {
  const { t } = useTranslation();
  const [emailSentTo, setEmailSentTo] = React.useState("");
  const hints = React.useMemo(() => readSessionHints(), []);
  const lastHint = Object.values(hints)[0];

  return (
    <Card>
      <h2>{t("Sign in")}</h2>
      <p className="lead">
        {t("Use your TIN identity. Your workspaces follow your account.")}
      </p>

      {lastHint ? (
        <div className="stack" style={{ marginBottom: 14 }}>
          <Button
            neutral
            onClick={() => {
              window.location.href = lastHint.url;
            }}
          >
            {t("Continue to {{ name }}", { name: lastHint.name })}
          </Button>
        </div>
      ) : null}

      <div className="stack">
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

      {emailSentTo ? (
        <p className="sent">
          {t("A sign-in link is on its way to {{ email }}.", {
            email: emailSentTo,
          })}
        </p>
      ) : null}

      <div className="divider">{t("know your workspace?")}</div>

      <WorkspaceFinder title={t("Know your workspace?")} />

      <div className="foot">
        {config.accessEmail ? (
          <span>
            {t("Need access?")}{" "}
            <a href={`mailto:${config.accessEmail}`}>
              {t("Contact your TIN administrator")}
            </a>
            .
          </span>
        ) : (
          <span>{t("Need access? Contact your TIN administrator.")}</span>
        )}
      </div>
    </Card>
  );
}
