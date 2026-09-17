import { Team, User } from "@server/models";
import { allow } from "./cancan";
import {
  and,
  isCloudHosted,
  isTeamAdmin,
  isTeamModel,
  isTeamMutable,
  or,
} from "./utils";

allow(User, "read", Team, isTeamModel);

allow(User, "readTemplate", Team, (actor, team) =>
  and(
    //
    !actor.isGuest,
    !actor.isViewer,
    isTeamModel(actor, team)
  )
);

allow(User, "share", Team, (actor, team) =>
  and(
    isTeamModel(actor, team),
    !actor.isGuest,
    !actor.isViewer,
    !!team?.sharing
  )
);

// PoC-1: `isCloudHosted()` removed so self-hosted instances can create
// additional workspaces (teams). Team acts as the tenant boundary.
allow(User, "createTeam", Team, (actor, team) =>
  and(
    //
    !actor.isGuest,
    !actor.isViewer,
    or(actor.isAdmin, !!team?.memberTeamCreate)
  )
);

allow(User, "update", Team, isTeamAdmin);

allow(User, ["delete", "audit"], Team, (actor, team) =>
  and(
    //
    isCloudHosted(),
    isTeamAdmin(actor, team)
  )
);

allow(User, ["createTemplate", "updateTemplate"], Team, (actor, team) =>
  and(
    //
    actor.isAdmin,
    isTeamModel(actor, team),
    isTeamMutable(actor)
  )
);

// Platform-wide ops console access: only a user explicitly flagged as a
// Platform Admin may manage tenants across all companies. This is scoped to
// the actor's own team model for the boundary check but the capability itself
// is global (independent of the target tenant).
allow(User, "manageOps", Team, (actor, team) =>
  and(
    //
    actor.isPlatformAdmin,
    isTeamModel(actor, team)
  )
);
