import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { getBaseDomain } from "@shared/utils/domains";
import Button from "~/components/Button";
import { isValidWorkspaceSlug, tenantOriginFor } from "../urls";
import { vaultTheme } from "../theme";

const Box = styled.div`
  padding-top: 24px;
  border-top: 1px solid ${vaultTheme.line};

  label {
    display: block;
    margin: 0 0 10px;
    font-size: 13.5px;
    font-weight: 600;
    color: ${vaultTheme.navy800};
  }

  .input-row {
    display: flex;
    gap: 8px;
  }

  .field {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 46px;
    padding: 0 14px;
    border-radius: ${vaultTheme.radiusCtrl};
    border: 1px solid #d3dae4;
    background: ${vaultTheme.card};
    font-family: ${vaultTheme.fontMono};
    font-size: 13.5px;

    &:focus-within {
      outline: 2px solid ${vaultTheme.orange};
      outline-offset: 2px;
    }
  }

  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    padding: 0;
    background: transparent;
    color: ${vaultTheme.navy800};
    font: inherit;

    &::placeholder {
      color: #7d8b9d;
    }
  }

  .suffix {
    flex: none;
    color: #6f7e93;
  }

  button {
    width: auto;
    min-width: 64px;
    height: 46px;
  }

  .helper {
    margin: 8px 0 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: ${vaultTheme.muted};
  }
`;

type Props = {
  /** Label rendered above the input. */
  title: string;
};

/**
 * The "Know your workspace?" navigation aid. Purely client side: validates
 * the slug character set and navigates to the tenant origin. Never queries
 * the server, so it cannot enumerate workspaces.
 *
 * @returns The form element.
 */
export function WorkspaceFinder({ title }: Props) {
  const { t } = useTranslation();
  const [note, setNote] = React.useState<string | null>(null);

  const handleSubmit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("slug");
    const raw =
      input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : "";

    if (!isValidWorkspaceSlug(raw)) {
      setNote(
        t("Use the workspace name from your invite, letters and dashes only.")
      );
      return;
    }

    setNote(t("Opening {{ slug }}.docs.tin.info", { slug: raw }));
    window.location.href = tenantOriginFor(raw);
  };

  return (
    <Box>
      <form onSubmit={handleSubmit}>
        <label htmlFor="vault-workspace-finder">{title}</label>
        <div className="input-row">
          <div className="field">
            <input
              id="vault-workspace-finder"
              name="slug"
              placeholder={t("workspace")}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="suffix" aria-hidden="true">
              .{getBaseDomain()}
            </span>
          </div>
          <Button type="submit">{t("Go")}</Button>
        </div>
        <p className="helper" aria-live="polite">
          {note ??
            t(
              "Takes you to that workspace's sign-in. It never grants access by itself."
            )}
        </p>
      </form>
    </Box>
  );
}
