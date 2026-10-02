import { endOfDay } from "date-fns";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { errToString } from "@shared/utils/error";
import { ApiKeyValidation } from "@shared/validations";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import useUserLocale from "~/hooks/useUserLocale";
import { dateToExpiry } from "~/utils/date";
import ExpiryDatePicker from "./components/ExpiryDatePicker";
import { ScopePicker } from "./components/ScopePicker";
import { emptySelection, selectionToScopes } from "./scopes";
import { ExpiryType, ExpiryValues, calculateExpiryDate } from "./utils";

type Props = {
  onSubmit: () => void;
};

function ApiKeyNew({ onSubmit }: Props) {
  const [name, setName] = React.useState("");
  const [selection, setSelection] = React.useState(emptySelection);
  const [advanced, setAdvanced] = React.useState(false);
  const [rawScope, setRawScope] = React.useState("");
  const [expiryType, setExpiryType] = React.useState<ExpiryType>(
    ExpiryType.Month
  );
  const currentDate = React.useRef<Date>(new Date());
  const [expiresAt, setExpiresAt] = React.useState<Date | undefined>(() =>
    calculateExpiryDate(currentDate.current, expiryType)
  );
  const [isSaving, setIsSaving] = React.useState(false);

  const { apiKeys } = useStores();
  const { t } = useTranslation();
  const userLocale = useUserLocale();

  const scopes = React.useMemo(
    () =>
      advanced
        ? rawScope.split(/[\s,]+/).filter(Boolean)
        : selectionToScopes(selection),
    [advanced, rawScope, selection]
  );

  const submitDisabled =
    isSaving ||
    !name ||
    scopes.length === 0 ||
    (!expiresAt && expiryType !== ExpiryType.NoExpiration);

  const expiryOptions = React.useMemo<Option[]>(
    () =>
      [...ExpiryValues.entries()].map(([expType, { label }]) => ({
        type: "item",
        label,
        value: expType,
      })),
    []
  );

  const handleNameChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const handleRawScopeChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRawScope(event.target.value);
    },
    []
  );

  const handleToggleAdvanced = React.useCallback(() => {
    setAdvanced((value) => !value);
  }, []);

  const handleExpiryTypeChange = React.useCallback((value: string) => {
    const expiry = value as ExpiryType;
    setExpiryType(expiry);
    setExpiresAt(calculateExpiryDate(currentDate.current, expiry));
  }, []);

  const handleSelectCustomDate = React.useCallback((date: Date) => {
    setExpiresAt(endOfDay(date));
  }, []);

  const handleSubmit = React.useCallback(
    async (ev: React.SyntheticEvent) => {
      ev.preventDefault();
      setIsSaving(true);

      try {
        await apiKeys.create({
          name,
          expiresAt: expiresAt?.toISOString(),
          scope: scopes,
        });
        toast.success(
          t(
            "API key created. Please copy the value now as it will not be shown again."
          )
        );
        onSubmit();
      } catch (err) {
        toast.error(errToString(err));
      } finally {
        setIsSaving(false);
      }
    },
    [t, name, scopes, expiresAt, onSubmit, apiKeys]
  );

  return (
    <form onSubmit={handleSubmit}>
      <Flex column>
        <Input
          type="text"
          label={t("Name")}
          placeholder={t("Development")}
          onChange={handleNameChange}
          value={name}
          minLength={ApiKeyValidation.minNameLength}
          maxLength={ApiKeyValidation.maxNameLength}
          required
          autoFocus
          flex
        />
        <HelperText type="secondary" size="small" as="p">
          {t("Choose what this key is allowed to do.")}
        </HelperText>
        {advanced ? (
          <>
            <Input
              type="text"
              label={t("Scopes")}
              placeholder="documents:read /api/collections.list"
              onChange={handleRawScopeChange}
              value={rawScope}
              flex
            />
            <Text type="secondary" size="small" as="p">
              {t(
                "Space-separated scopes. Use * for full access. At least one scope is required"
              )}
              .
            </Text>
          </>
        ) : (
          <ScopePicker value={selection} onChange={setSelection} />
        )}
        <AdvancedRow>
          <Button type="button" neutral onClick={handleToggleAdvanced}>
            {advanced ? t("Use the picker") : t("Advanced")}
          </Button>
        </AdvancedRow>
        <Flex align="center" gap={8}>
          <StyledExpirySelect
            options={expiryOptions}
            value={expiryType}
            onChange={handleExpiryTypeChange}
            label={t("Expiration")}
          />
          {expiryType === ExpiryType.Custom ? (
            <ExpiryDatePicker
              selectedDate={expiresAt}
              onSelect={handleSelectCustomDate}
            />
          ) : (
            <StyledExpiryText type="secondary" size="small">
              {expiresAt
                ? `${dateToExpiry(expiresAt.toString(), t, userLocale)}.`
                : `${t("Never expires")}.`}
            </StyledExpiryText>
          )}
        </Flex>
      </Flex>
      <Flex justify="flex-end">
        <Button type="submit" disabled={submitDisabled}>
          {isSaving ? `${t("Creating")}…` : t("Create")}
        </Button>
      </Flex>
    </form>
  );
}

const HelperText = styled(Text)`
  margin-top: 4px;
  margin-bottom: 12px;
`;

const AdvancedRow = styled(Flex)`
  margin: 12px 0 20px;
`;

const StyledExpirySelect = styled(InputSelect)`
  width: 150px !important;
  margin-bottom: 16px;
`;

const StyledExpiryText = styled(Text)`
  position: relative;
  top: 4px;
`;

export default ApiKeyNew;
