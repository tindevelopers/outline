import { CollectionPermission, UserRole } from "@shared/types";
import { User, UserMembership } from "@server/models";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildGuestUser,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import guestInviter from "./guestInviter";

describe("guestInviter", () => {
  it("should create a guest scoped to the collection", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const { user, membership } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "outsider@example.com",
          name: "Outsider",
          collectionId: collection.id,
          permission: CollectionPermission.ReadWrite,
        },
      })
    );

    expect(user.email).toEqual("outsider@example.com");
    expect(user.role).toEqual(UserRole.Guest);
    expect(membership.collectionId).toEqual(collection.id);
    expect(membership.permission).toEqual(CollectionPermission.ReadWrite);
  });

  it("should allow an outside domain that a staff invite would reject", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const { user } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "someone@not-in-the-allowlist.test",
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    expect(user.role).toEqual(UserRole.Guest);
  });

  it("should reuse an existing staff user without changing their role", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const editor = await buildUser({
      teamId: team.id,
      email: "editor@example.com",
    });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const { user } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "editor@example.com",
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    expect(user.id).toEqual(editor.id);
    expect(user.role).toEqual(UserRole.Member);
  });

  it("should reuse an existing guest and update the permission", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const guest = await buildGuestUser({
      teamId: team.id,
      email: "guest@example.com",
    });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const first = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "guest@example.com",
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );
    const second = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "guest@example.com",
          collectionId: collection.id,
          permission: CollectionPermission.ReadWrite,
        },
      })
    );

    expect(first.user.id).toEqual(guest.id);
    expect(second.user.id).toEqual(guest.id);
    expect(second.membership.id).toEqual(first.membership.id);
    expect(second.membership.permission).toEqual(
      CollectionPermission.ReadWrite
    );

    const count = await UserMembership.count({
      where: { userId: guest.id, collectionId: collection.id },
    });
    expect(count).toEqual(1);
  });

  it("should reject the manage permission", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    await expect(
      withAPIContext(admin, (ctx) =>
        guestInviter(ctx, {
          invite: {
            email: "outsider@example.com",
            collectionId: collection.id,
            permission: CollectionPermission.Admin,
          },
        })
      )
    ).rejects.toThrow();
  });

  it("should refuse an actor who only has edit permission", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const editor = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
      permission: null,
    });
    await UserMembership.create({
      createdById: admin.id,
      collectionId: collection.id,
      userId: editor.id,
      permission: CollectionPermission.ReadWrite,
    });

    await expect(
      withAPIContext(editor, (ctx) =>
        guestInviter(ctx, {
          invite: {
            email: "refused-editor@example.com",
            collectionId: collection.id,
            permission: CollectionPermission.Read,
          },
        })
      )
    ).rejects.toThrow();

    const created = await User.findOne({
      where: { email: "refused-editor@example.com" },
    });
    expect(created).toBeNull();
  });

  it("should allow an actor holding manage on the collection", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const manager = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
      permission: null,
    });
    await UserMembership.create({
      createdById: admin.id,
      collectionId: collection.id,
      userId: manager.id,
      permission: CollectionPermission.Admin,
    });

    const { user } = await withAPIContext(manager, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "outsider@example.com",
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    expect(user.role).toEqual(UserRole.Guest);
  });

  it("should scope a document invite to the document", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
      createdById: admin.id,
    });

    const { membership } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "outsider@example.com",
          documentId: document.id,
          permission: CollectionPermission.ReadWrite,
        },
      })
    );

    expect(membership.documentId).toEqual(document.id);
    expect(membership.collectionId).toBeNull();
  });
});
