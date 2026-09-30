import { InviteMaxSends, InviteResendCooldownMs } from "@shared/constants";
import { UserRole } from "@shared/types";
import GuestInviteEmail from "@server/emails/templates/GuestInviteEmail";
import InviteEmail from "@server/emails/templates/InviteEmail";
import { AuthorizationError, ValidationError } from "@server/errors";
import type { User } from "@server/models";
import {
  actorManagesAnyItemOf,
  getGuestInviteItem,
} from "@server/models/helpers/InviteHelper";
import { UserFlag } from "@server/models/User";
import { can } from "@server/policies";
import type { APIContext } from "@server/types";

type Props = {
  /** The invited user to resend to. */
  user: User;
};

/**
 * Resends an outstanding invitation and restarts its lifecycle: the window
 * reopens, the reminder count resets, and the expiry notice is re-armed.
 * A guest receives the guest invite email naming their item; everyone else
 * receives the workspace invite.
 *
 * @param ctx The request context, carrying the actor and the transaction.
 * @param props.user The invited user to resend to.
 * @throws AuthorizationError when the target has no outstanding invite, or the actor may neither administer the team nor manage a shared item.
 * @throws ValidationError when the cooldown has not elapsed, the send ceiling is reached, or a guest holds nothing.
 */
export default async function inviteResender(
  ctx: APIContext,
  { user }: Props
): Promise<void> {
  const { user: actor } = ctx.state.auth;
  const { transaction } = ctx.state;

  // The admin policy already requires a pending invite; the manager branch
  // below only inspects shared items, so without this an active user could be
  // re-invited through an item they merely hold access to.
  if (!user.isInvited) {
    throw AuthorizationError();
  }

  const isAdmin = can(actor, "resendInvite", user);

  // Mirror the guest exclusion in the collection policy's `inviteGuest`
  // ability: a guest holding manage on a shared item must not be able to grow
  // its own access by re-inviting. The admin path already excludes guests,
  // since `isTeamAdmin` requires a staff admin.
  const managesItem =
    !actor.isGuest && (await actorManagesAnyItemOf(actor.id, user.id));

  if (!isAdmin && !managesItem) {
    throw AuthorizationError();
  }

  const now = new Date();
  const lastSentAt = user.inviteLastSentAt ?? user.createdAt;

  if (now.getTime() < lastSentAt.getTime() + InviteResendCooldownMs) {
    throw ValidationError("This invite was sent recently, try again tomorrow");
  }

  if (user.getFlag(UserFlag.InviteSent) >= InviteMaxSends) {
    throw ValidationError("This invite has been sent too many times");
  }

  // Resolve the guest's item before mutating anything, so a guest with nothing
  // to name fails without consuming a send or reopening the window.
  const item =
    user.role === UserRole.Guest ? await getGuestInviteItem(user.id) : null;

  if (user.role === UserRole.Guest && !item) {
    throw ValidationError("This guest no longer has access to anything");
  }

  // Re-anchor before signing, otherwise the new token would inherit the
  // expired window it is replacing.
  user.restartInviteLifecycle();
  const token = user.getInviteToken();

  if (item) {
    await new GuestInviteEmail({
      to: user.email,
      language: user.language,
      name: user.name,
      actorName: actor.name,
      teamName: actor.team.name,
      teamUrl: actor.team.url,
      itemName: item.itemName,
      isCollection: item.isCollection,
      token,
    }).schedule();
  } else {
    await new InviteEmail({
      to: user.email,
      language: user.language,
      name: user.name,
      actorName: actor.name,
      actorEmail: actor.email,
      teamName: actor.team.name,
      teamUrl: actor.team.url,
      token,
    }).schedule();
  }

  await user.save({ transaction });
}
