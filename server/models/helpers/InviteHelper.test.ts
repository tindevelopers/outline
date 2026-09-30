import {
  CollectionPermission,
  DocumentPermission,
  UserRole,
} from "@shared/types";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildInvite,
  buildUser,
} from "@server/test/factories";
import { getGuestInviteItem, managerIdsFor } from "./InviteHelper";
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

describe("managerIdsFor", () => {
  it("returns the admin of a collection the user holds", async () => {
    const guest = await buildGuest();
    const manager = await buildAdmin({ teamId: guest.teamId });
    // A collection's creator holds admin on it automatically.
    const collection = await buildCollection({
      teamId: guest.teamId,
      createdById: manager.id,
    });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: manager.id,
    });

    expect(await managerIdsFor(guest.id)).toEqual([manager.id]);
  });

  it("returns the admin of a document the user holds", async () => {
    const guest = await buildGuest();
    const document = await buildDocument({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      documentId: document.id,
      permission: DocumentPermission.Read,
      createdById: guest.invitedById!,
    });
    const manager = await buildAdmin({ teamId: guest.teamId });
    await UserMembership.create({
      userId: manager.id,
      documentId: document.id,
      permission: DocumentPermission.Admin,
      createdById: manager.id,
    });

    expect(await managerIdsFor(guest.id)).toEqual([manager.id]);
  });

  it("excludes users who hold only read or read-write permission", async () => {
    const guest = await buildGuest();
    const owner = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({
      teamId: guest.teamId,
      createdById: owner.id,
    });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: owner.id,
    });

    const reader = await buildUser({ teamId: guest.teamId });
    await UserMembership.create({
      userId: reader.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: owner.id,
    });
    const writer = await buildUser({ teamId: guest.teamId });
    await UserMembership.create({
      userId: writer.id,
      collectionId: collection.id,
      permission: CollectionPermission.ReadWrite,
      createdById: owner.id,
    });

    const ids = await managerIdsFor(guest.id);

    // Only the collection's admin owner, never the read or read-write holders.
    expect(ids).toEqual([owner.id]);
    expect(ids).not.toContain(reader.id);
    expect(ids).not.toContain(writer.id);
  });
});
