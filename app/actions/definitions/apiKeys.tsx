import copy from "copy-to-clipboard";
import { CopyIcon, PlusIcon, ReplaceIcon, TrashIcon } from "outline-icons";
import { toast } from "sonner";
import stores from "~/stores";
import env from "~/env";
import type ApiKey from "~/models/ApiKey";
import ApiKeyNew from "~/scenes/ApiKeyNew";
import ApiKeyRegenerateDialog from "~/scenes/Settings/components/ApiKeyRegenerateDialog";
import ApiKeyRevokeDialog from "~/scenes/Settings/components/ApiKeyRevokeDialog";
import { createAction } from "..";
import { dialogActionFactory } from "./common";
import { SettingsSection } from "../sections";

export const createApiKey = dialogActionFactory({
  analyticsName: "New API key",
  section: SettingsSection,
  name: (t) => t("New API key"),
  title: (t) => t("New API key"),
  content: (onSubmit) => <ApiKeyNew onSubmit={onSubmit} />,
  icon: <PlusIcon />,
  keywords: "create",
  stopEvent: true,
  visible: () =>
    stores.policies.abilities(stores.auth.team?.id || "").createApiKey,
});

export const copyApiKeyActionFactory = ({ apiKey }: { apiKey: ApiKey }) =>
  createAction({
    name: ({ t }) => t("Copy"),
    analyticsName: "Copy API key",
    section: SettingsSection,
    icon: <CopyIcon />,
    visible: () => !!apiKey.value,
    perform: ({ t }) => {
      copy(apiKey.value, {
        debug: env.ENVIRONMENT !== "production",
        format: "text/plain",
      });
      toast.success(t("API key copied"));
    },
  });

export const regenerateApiKeyActionFactory = ({ apiKey }: { apiKey: ApiKey }) =>
  createAction({
    name: ({ t, isMenu }) =>
      isMenu ? `${t("Regenerate")}…` : t("Regenerate API key"),
    analyticsName: "Regenerate API key",
    section: SettingsSection,
    icon: <ReplaceIcon />,
    keywords: "regenerate rotate replace",
    dangerous: true,
    visible: () => !apiKey.isExpired,
    perform: ({ t, event }) => {
      event?.preventDefault();
      event?.stopPropagation();

      stores.dialogs.openModal({
        title: t("Regenerate API key"),
        content: (
          <ApiKeyRegenerateDialog
            onSubmit={stores.dialogs.closeAllModals}
            apiKey={apiKey}
          />
        ),
      });
    },
  });

export const revokeApiKeyActionFactory = ({ apiKey }: { apiKey: ApiKey }) =>
  createAction({
    name: ({ t, isMenu }) =>
      isMenu
        ? apiKey.isExpired
          ? t("Delete")
          : `${t("Revoke")}…`
        : t("Revoke API key"),
    analyticsName: "Revoke API key",
    section: SettingsSection,
    icon: <TrashIcon />,
    keywords: "revoke delete remove",
    dangerous: true,
    perform: async ({ t, event }) => {
      event?.preventDefault();
      event?.stopPropagation();

      if (apiKey.isExpired) {
        await apiKey.delete();
        return;
      }

      stores.dialogs.openModal({
        title: t("Revoke token"),
        content: (
          <ApiKeyRevokeDialog
            onSubmit={stores.dialogs.closeAllModals}
            apiKey={apiKey}
          />
        ),
      });
    },
  });
