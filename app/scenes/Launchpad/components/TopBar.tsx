import * as React from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { vaultTheme } from "../theme";
import { TinMark } from "./TinMark";

const Bar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26px 48px;
  color: ${vaultTheme.navy800};

  .host {
    font-family: ${vaultTheme.fontMono};
    font-size: 12px;
    color: ${vaultTheme.muted};
  }

  @media (max-width: 940px) {
    padding: 20px;
  }
`;

type Props = {
  /** The host this Launchpad serves, shown as an orientation cue. */
  host: string;
};

/**
 * The Launchpad top bar: TIN lockup left, current host right.
 *
 * @returns The header element.
 */
export function TopBar({ host }: Props) {
  const { t } = useTranslation();

  return (
    <Bar>
      <TinMark size={27} />
      <span className="host" aria-label={t("Current host")}>
        {host}
      </span>
    </Bar>
  );
}
