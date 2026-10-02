import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Text from "~/components/Text";
import {
  ACCESS_AREAS,
  SCOPE_PRESETS,
  type AccessLevel,
  type ScopeSelection,
} from "../scopes";

interface Props {
  value: ScopeSelection;
  onChange: (value: ScopeSelection) => void;
}

/**
 * Presets plus a table of areas, each with a None, Read, Read and create, or
 * Full choice. Selecting Full access disables the table.
 *
 * @param props.value the current selection.
 * @param props.onChange called with the new selection on every change.
 * @returns the picker.
 */
export function ScopePicker({ value, onChange }: Props) {
  const { t } = useTranslation();

  const levelOptions = React.useCallback(
    (canCreate: boolean): Option[] => {
      const options: Option[] = [
        { type: "item", label: t("None"), value: "none" },
        { type: "item", label: t("Read"), value: "read" },
      ];
      if (canCreate) {
        options.push({
          type: "item",
          label: t("Read and create"),
          value: "create",
        });
      }
      options.push({ type: "item", label: t("Full"), value: "write" });
      return options;
    },
    [t]
  );

  const handleLevelChange = React.useCallback(
    (areaId: string, level: string) => {
      onChange({
        full: false,
        levels: { ...value.levels, [areaId]: level as AccessLevel },
      });
    },
    [onChange, value.levels]
  );

  return (
    <Flex column gap={8}>
      <Flex gap={8} wrap>
        {SCOPE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            neutral
            onClick={() => onChange(preset.selection())}
          >
            {preset.label}
          </Button>
        ))}
      </Flex>
      {value.full && (
        <Text type="secondary" size="small" as="p">
          {t(
            "This key can do everything you can do, including managing users and settings."
          )}
        </Text>
      )}
      <Rows $disabled={value.full} aria-disabled={value.full}>
        {ACCESS_AREAS.map((area) => (
          <Row key={area.id}>
            <Flex column>
              <Text>{area.label}</Text>
              {area.hint && !value.full && (
                <Text type="tertiary" size="xsmall">
                  {area.hint}
                </Text>
              )}
            </Flex>
            <StyledSelect
              label={area.label}
              labelHidden
              short
              disabled={value.full}
              options={levelOptions(area.canCreate)}
              value={value.full ? "none" : (value.levels[area.id] ?? "none")}
              onChange={(level) => handleLevelChange(area.id, level)}
            />
          </Row>
        ))}
      </Rows>
    </Flex>
  );
}

const Rows = styled.div<{ $disabled: boolean }>`
  max-height: 240px;
  overflow-y: auto;
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  border-top: 1px solid ${s("divider")};
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid ${s("divider")};
`;

const StyledSelect = styled(InputSelect)`
  width: 160px !important;
  margin-bottom: 0;
`;
