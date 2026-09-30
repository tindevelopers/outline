import { CollectionPermission, UserRole } from "@shared/types";
import GuestInviteEmail from "@server/emails/templates/GuestInviteEmail";
import { ValidationError } from "@server/errors";
import { Collection, Document, User, UserMembership } from "@server/models";
import { UserFlag } from "@server/models/User";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";

export type GuestInvite = {
  /** Email address of the outside collaborator. */
  email: string;
  /** Display name; defaults to the email address. */
  name?: string;
  /** Target collection, mutually exclusive with documentId. */
  collectionId?: string;
  /** Target document, mutually exclusive with collectionId. */
  documentId?: string;
  /** The level to grant. Never admin. */
  permission: CollectionPermission;
};

type Props = {
  invite: GuestInvite;
};

/**
 * Invites an outside email address to a single collection or document.
 * Creates the guest account when the email is unknown, attaches the
 * membership, and sends the invite email. Existing users keep their role:
 * a staff member who is shared an item receives only the membership.
 *
 * @param ctx The request context, carrying the actor and the transaction.
 * @param props.invite The invite to process.
 * @returns The guest user and the membership that was created or updated.
 * @throws ValidationError when the permission is admin or the target is ambiguous.
 */
export default async function guestInviter(
  ctx: APIContext,
  { invite }: Props
): Promise<{ user: User; membership: UserMembership }> {
  const { user: actor } = ctx.state.auth;
  const { transaction } = ctx.state;

  if (invite.permission === CollectionPermission.Admin) {
    throw ValidationError("Guests cannot be granted manage permissions");
  }
  if (!!invite.collectionId === !!invite.documentId) {
    throw ValidationError(
      "Exactly one of collectionId or documentId must be provided"
    );
  }

  const email = invite.email.trim().toLowerCase();

  const collection = invite.collectionId
    ? await Collection.findByPk(invite.collectionId, {
        userId: actor.id,
        rejectOnEmpty: true,
        transaction,
      })
    : null;

  const document = invite.documentId
    ? await Document.findByPk(invite.documentId, {
        userId: actor.id,
        rejectOnEmpty: true,
        transaction,
      })
    : null;

  if (collection) {
    authorize(actor, "inviteGuest", collection);
  } else if (document) {
    authorize(actor, "inviteGuest", document);
  } else {
    throw ValidationError(
      "Exactly one of collectionId or documentId must be provided"
    );
  }

  // An existing user keeps their role. A staff member who is shared an item
  // receives only the membership, and an existing guest is reused as is.
  let target = await User.findOne({
    where: { teamId: actor.teamId, email },
    transaction,
  });

  if (!target) {
    target = await User.createWithCtx(
      ctx,
      {
        teamId: actor.teamId,
        name: invite.name?.trim() || email,
        email,
        role: UserRole.Guest,
        invitedById: actor.id,
        inviteLastSentAt: new Date(),
        flags: {
          [UserFlag.InviteSent]: 1,
        },
      },
      { name: "invite_guest" }
    );
  } else if (target.isInvited) {
    // The guest is being emailed again, so their lifecycle restarts. An
    // existing active member is not invited and has no clock to restart.
    target.restartInviteLifecycle();
    await target.saveWithCtx(ctx);
  }

  const where = collection
    ? { collectionId: collection.id, userId: target.id }
    : { documentId: document!.id, userId: target.id };

  // Collections are named, documents are titled.
  const itemName = collection ? collection.name : document!.title;

  let membership = await UserMembership.findOne({ where, transaction });

  if (membership) {
    membership.permission = invite.permission;
    await membership.saveWithCtx(ctx);
  } else {
    membership = await UserMembership.createWithCtx(ctx, {
      ...where,
      permission: invite.permission,
      createdById: actor.id,
    });
  }

  await new GuestInviteEmail({
    to: email,
    language: target.language,
    name: target.name,
    actorName: actor.name,
    teamName: actor.team.name,
    teamUrl: actor.team.url,
    itemName,
    isCollection: !!collection,
    token: target.getInviteToken(),
  }).schedule();

  return { user: target, membership };
}
