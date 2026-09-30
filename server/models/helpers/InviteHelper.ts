import { Op } from "sequelize";
import { CollectionPermission } from "@shared/types";
import { Collection, Document, UserMembership } from "@server/models";

export interface InviteItem {
  /** Display name of the shared collection or document. */
  itemName: string;
  /** Whether the shared item is a collection rather than a document. */
  isCollection: boolean;
  collectionId?: string;
  documentId?: string;
}

/**
 * Returns the collection or document a guest was most recently invited to,
 * skipping memberships whose item no longer exists.
 *
 * @param userId the guest's id.
 * @returns the item, or null when the guest holds no memberships or none of
 * them resolves to a live collection or document.
 */
export async function getGuestInviteItem(
  userId: string
): Promise<InviteItem | null> {
  const memberships = await UserMembership.findAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
  });

  for (const membership of memberships) {
    if (membership.collectionId) {
      const collection = await Collection.findByPk(membership.collectionId);
      if (collection) {
        return {
          itemName: collection.name,
          isCollection: true,
          collectionId: collection.id,
        };
      }
    }

    if (membership.documentId) {
      const document = await Document.findByPk(membership.documentId);
      if (document) {
        return {
          itemName: document.title,
          isCollection: false,
          documentId: document.id,
        };
      }
    }
  }

  return null;
}

/**
 * Whether the actor holds manage permission on any collection or document the
 * given user has access to. Group-derived access is not considered.
 *
 * @param actorId the acting user's id.
 * @param userId the invited user's id.
 * @returns true when the actor manages at least one shared item.
 */
export async function actorManagesAnyItemOf(
  actorId: string,
  userId: string
): Promise<boolean> {
  const memberships = await UserMembership.findAll({ where: { userId } });
  const collectionIds = memberships
    .map((membership) => membership.collectionId)
    .filter((id): id is string => !!id);
  const documentIds = memberships
    .map((membership) => membership.documentId)
    .filter((id): id is string => !!id);

  if (!collectionIds.length && !documentIds.length) {
    return false;
  }

  const managed = await UserMembership.findOne({
    where: {
      userId: actorId,
      permission: CollectionPermission.Admin,
      [Op.or]: [
        ...(collectionIds.length
          ? [{ collectionId: { [Op.in]: collectionIds } }]
          : []),
        ...(documentIds.length
          ? [{ documentId: { [Op.in]: documentIds } }]
          : []),
      ],
    },
  });

  return !!managed;
}

/**
 * Ids of every user who holds manage permission on a collection or document
 * the given user has access to. Group-derived access is not considered.
 *
 * @param userId the invited user's id.
 * @returns the manager ids, possibly empty.
 */
export async function managerIdsFor(userId: string): Promise<string[]> {
  const memberships = await UserMembership.findAll({ where: { userId } });
  const collectionIds = memberships
    .map((membership) => membership.collectionId)
    .filter((id): id is string => !!id);
  const documentIds = memberships
    .map((membership) => membership.documentId)
    .filter((id): id is string => !!id);

  if (!collectionIds.length && !documentIds.length) {
    return [];
  }

  const managers = await UserMembership.findAll({
    where: {
      permission: CollectionPermission.Admin,
      [Op.or]: [
        ...(collectionIds.length
          ? [{ collectionId: { [Op.in]: collectionIds } }]
          : []),
        ...(documentIds.length
          ? [{ documentId: { [Op.in]: documentIds } }]
          : []),
      ],
    },
  });

  return [...new Set(managers.map((membership) => membership.userId))];
}
