import { ArrowIcon, PlusIcon, ShapesIcon } from "outline-icons";
import styled from "styled-components";
import { stringToColor } from "@shared/utils/color";
import { getBaseDomain } from "@shared/utils/domains";
import type RootStore from "~/stores/RootStore";
import { LoginDialog } from "~/scenes/Login/components/LoginDialog";
import TeamNew from "~/scenes/TeamNew";
import TeamLogo from "~/components/TeamLogo";
import { createAction, createActionWithChildren } from "~/actions";
import type { Action, ActionContext } from "~/types";
import Desktop from "~/utils/Desktop";
import { dialogActionFactory } from "./common";
import { TeamSection } from "../sections";

/**
 * The origin of the vault Launchpad for this installation, preserving the
 * protocol and port so local and preview hosts work.
 *
 * @returns The Launchpad origin URL.
 */
function launchpadOrigin(): string {
  const { protocol, port } = window.location;
  return `${protocol}//${getBaseDomain()}${port ? `:${port}` : ""}`;
}

/**
 * Drops the base-domain sign-in hints so the Launchpad starts clean.
 *
 * @returns nothing.
 */
function clearSessionHints(): void {
  const past = new Date(0).toUTCString();
  const domain = getBaseDomain();
  document.cookie = `sessions=; expires=${past}; path=/; domain=${domain}`;
  document.cookie = `lastSignedIn=; expires=${past}; path=/; domain=${domain}`;
}

export const switchTeamsList = ({ stores }: { stores: RootStore }) =>
  stores.auth.availableTeams?.map<Action>((session) =>
    createAction({
      id: `switch-${session.id}`,
      name: session.name,
      analyticsName: "Switch workspace",
      section: TeamSection,
      keywords: "change switch workspace organization team",
      icon: (
        <StyledTeamLogo
          alt={session.name}
          model={{
            initial: session.name[0],
            avatarUrl: session.avatarUrl,
            id: session.id,
            color: stringToColor(session.id),
          }}
          size={24}
        />
      ),
      visible: ({ currentTeamId }: ActionContext) =>
        currentTeamId !== session.id,
      perform: async () => {
        try {
          // Hand off with a transfer token so the target workspace receives a
          // session without logging the current one out.
          const url = await stores.auth.transferToTeam(session.id);
          window.location.href = url;
        } catch (_err) {
          window.location.href = session.url;
        }
      },
    })
  ) ?? [];

export const switchTeam = createActionWithChildren({
  name: ({ t }) => t("Switch workspace"),
  placeholder: ({ t }) => t("Select a workspace"),
  analyticsName: "Switch workspace",
  keywords: "change switch workspace organization team",
  section: TeamSection,
  visible: ({ stores }) =>
    !!stores.auth.availableTeams && stores.auth.availableTeams?.length > 1,
  children: switchTeamsList,
});

export const createTeam = createAction({
  name: ({ t }) => `${t("New workspace")}…`,
  analyticsName: "Create workspace",
  keywords: "create change switch workspace organization team",
  section: TeamSection,
  icon: <PlusIcon />,
  visible: ({ stores, currentTeamId }) =>
    stores.policies.abilities(currentTeamId ?? "").createTeam,
  perform: ({ t, event, stores }) => {
    event?.preventDefault();
    event?.stopPropagation();
    const { user } = stores.auth;
    if (user) {
      stores.dialogs.openModal({
        title: t("Create a workspace"),
        content: <TeamNew user={user} />,
      });
    }
  },
});

export const goToLaunchpad = createAction({
  id: "vault-launchpad",
  name: ({ t }) => t("Launchpad, all workspaces"),
  analyticsName: "Open Launchpad",
  keywords: "launchpad vault workspaces entry",
  section: TeamSection,
  icon: <ShapesIcon />,
  visible: ({ stores }) =>
    !!stores.auth.availableTeams && stores.auth.availableTeams.length > 1,
  perform: () => {
    window.location.href = launchpadOrigin();
  },
});

export const signInToAnotherWorkspace = createAction({
  id: "vault-signin-other",
  name: ({ t }) => t("Sign in to another workspace"),
  analyticsName: "Sign in to another workspace",
  keywords: "sign in login another workspace account",
  section: TeamSection,
  icon: <ArrowIcon />,
  visible: ({ stores }) =>
    !!stores.auth.availableTeams && stores.auth.availableTeams.length > 1,
  perform: () => {
    clearSessionHints();
    window.location.href = launchpadOrigin();
  },
});

export const desktopLoginTeam = dialogActionFactory({
  analyticsName: "Login to workspace",
  section: TeamSection,
  name: (t) => t("Login to workspace"),
  title: (t) => t("Login to workspace"),
  content: () => <LoginDialog />,
  icon: <ArrowIcon />,
  keywords: "login workspace",
  stopEvent: true,
  visible: () => Desktop.isElectron(),
});

const StyledTeamLogo = styled(TeamLogo)`
  border-radius: 2px;
  border: 0;
`;

export const rootTeamActions = [switchTeam, createTeam, desktopLoginTeam];
