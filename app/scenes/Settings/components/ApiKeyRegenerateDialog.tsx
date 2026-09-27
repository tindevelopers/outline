import { addHours } from "date-fns";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiKeyValidation } from "@shared/validations";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Flex from "~/components/Flex";
import { InputSelect, type Option } from "~/components/InputSelect";
import Text from "~/components/Text";
import type ApiKey from "~/models/ApiKey";
import useStores from "~/hooks/useStores";
import useUserLocale from "~/hooks/useUserLocale";
import { dateToExpiry } from "~/utils/date";

type Props = {
  apiKey: ApiKey;
  onSubmit: () => void;
};

const ImmediateValue = "immediate";
const GracePeriodValue = "gracePeriod";

export default function ApiKeyRegenerateDialog({ apiKey, onSubmit }: Props) {
  const { t } = useTranslation();
  const { apiKeys } = useStores();
  const userLocale = useUserLocale();
  const [choice, setChoice] = React.useState(GracePeriodValue);

  const handleSubmit = async () => {
    await apiKeys.regenerate(apiKey, {
      gracePeriod: choice === GracePeriodValue,
    });
    toast.success(
      t(
        "API key regenerated. Please copy the new value now as it will not be shown again."
      )
    );
    onSubmit();
  };

  const options = React.useMemo<Option[]>(
    () => [
      { type: "item", label: t("Immediately"), value: ImmediateValue },
      {
        type: "item",
        label: t("After {{ hours }} hours", {
          hours: ApiKeyValidation.gracePeriodHours,
        }),
        value: GracePeriodValue,
      },
    ],
    [t]
  );

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={t("Regenerate")}
      savingText={`${t("Regenerating")}…`}
      danger
    >
      <Flex column gap={12}>
        <div>
          {t(
            "The current secret for the {{ tokenName }} token will be replaced. Update any services using this key with the new value.",
            { tokenName: apiKey.name }
          )}
        </div>
        <InputSelect
          label={t("Stop the current secret")}
          options={options}
          value={choice}
          onChange={setChoice}
        />
        <Text type="tertiary" size="small">
          {choice === GracePeriodValue
            ? t(
                "The current secret keeps working for {{ expiry }} so you can update services first.",
                {
                  expiry: dateToExpiry(
                    addHours(
                      new Date(),
                      ApiKeyValidation.gracePeriodHours
                    ).toISOString(),
                    t,
                    userLocale
                  ),
                }
              )
            : t("The current secret stops working immediately.")}
        </Text>
      </Flex>
    </ConfirmationDialog>
  );
}
