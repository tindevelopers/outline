import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import Button from "~/components/Button";
import { isValidWorkspaceSlug, tenantOriginFor } from "../urls";
import { vaultTheme } from "../theme";

const Box = styled.div`
  .input-row {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    min-width: 0;
    min-height: 46px;
    padding: 0 14px;
    border-radius: ${vaultTheme.radiusCtrl};
    border: 1px solid ${vaultTheme.line};
    background: ${vaultTheme.card};
    color: ${vaultTheme.ink};
    font-family: ${vaultTheme.fontMono};
    font-size: 14px;

    &::placeholder {
      color: #7d8b9d;
      font-family: ${vaultTheme.fontDisplay};
    }

    &:focus-visible {
      outline: 2px solid ${vaultTheme.orange};
      outline-offset: 2px;
    }
  }

  button {
    width: auto;
    min-width: 74px;
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
        <div className="input-row">
          <label htmlFor="vault-workspace-finder" style={{ position: "absolute", left: "-9999px" }}>
            {title}
          </label>
          <input
            id="vault-workspace-finder"
            name="slug"
            placeholder={t("e.g. programming")}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit">{t("Go")}</Button>
        </div>
        <p className="helper">
          {note ??
            t(
              "Goes straight to that workspace sign-in. Nothing is suggested, listed or searched."
            )}
        </p>
      </form>
    </Box>
  );
}
