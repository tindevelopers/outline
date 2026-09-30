import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errToString } from "@shared/utils/error";
import type User from "~/models/User";
import ConfirmationDialog from "~/components/ConfirmationDialog";

type Props = {
  /** The guest account that no longer holds access to anything. */
  user: User;
  /** Callback fired once the account has been removed. */
  onSubmit: () => void;
};

/**
 * Confirms removal of a guest account that no longer holds access to any
 * collection or document in the workspace.
 *
 * @param props the component props.
 * @returns the confirmation dialog.
 */
export default function RemoveGuestDialog({ user, onSubmit }: Props) {
  const { t } = useTranslation();

  const handleSubmit = async () => {
    try {
      await user.delete();
    } catch (err) {
      toast.error(errToString(err));
      return false;
    }

    onSubmit();
    return true;
  };

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={t("Remove")}
      savingText={`${t("Removing")}…`}
      danger
    >
      {t(
        "{{ userName }} no longer has access to anything in this workspace. Remove their account?",
        { userName: user.name }
      )}
    </ConfirmationDialog>
  );
}
