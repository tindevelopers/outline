import {
  CollectionPermission,
  DocumentPermission,
  UserRole,
} from "@shared/types";
import {
  buildCollection,
  buildDocument,
  buildInvite,
} from "@server/test/factories";
import { getGuestInviteItem } from "./InviteHelper";
import UserMembership from "@server/models/UserMembership";

const buildGuest = () => buildInvite({ role: UserRole.Guest });

describe("getGuestInviteItem", () => {
  it("names the collection a guest was invited to", async () => {
    const guest = await buildGuest();
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: guest.invitedById!,
    });

    const item = await getGuestInviteItem(guest.id);

    expect(item).toEqual({
      itemName: collection.name,
      isCollection: true,
      collectionId: collection.id,
    });
  });

  it("names the document a guest was invited to", async () => {
    const guest = await buildGuest();
    const document = await buildDocument({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      documentId: document.id,
      permission: DocumentPermission.Read,
      createdById: guest.invitedById!,
    });

    const item = await getGuestInviteItem(guest.id);

    expect(item).toEqual({
      itemName: document.title,
      isCollection: false,
      documentId: document.id,
    });
  });

  it("returns null when the guest holds nothing", async () => {
    const guest = await buildGuest();

    expect(await getGuestInviteItem(guest.id)).toBeNull();
  });

  it("falls back past a membership whose item is gone", async () => {
    const guest = await buildGuest();
    const document = await buildDocument({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      documentId: document.id,
      permission: DocumentPermission.Read,
      createdById: guest.invitedById!,
    });

    // A newer membership whose collection has been deleted. The foreign key is
    // ON DELETE SET NULL, so the row survives with a null collectionId.
    const stale = await UserMembership.create({
      userId: guest.id,
      collectionId: (await buildCollection({ teamId: guest.teamId })).id,
      permission: CollectionPermission.Read,
      createdById: guest.invitedById!,
    });
    await stale.update({ collectionId: null });

    const item = await getGuestInviteItem(guest.id);

    expect(item).toEqual({
      itemName: document.title,
      isCollection: false,
      documentId: document.id,
    });
  });
});
