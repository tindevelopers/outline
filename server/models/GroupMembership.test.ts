import { CollectionPermission } from "@shared/types";
import {
  buildAdmin,
  buildCollection,
  buildGroup,
  buildGuestUser,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import GroupMembership from "./GroupMembership";
import GroupUser from "./GroupUser";

describe("GroupMembership", () => {
  describe("withCollection scope", () => {
    it("should return the collection", async () => {
      const collection = await buildCollection();
      const group = await buildGroup();
      const user = await buildUser({ teamId: group.teamId });

      await GroupMembership.create({
        createdById: user.id,
        groupId: group.id,
        collectionId: collection.id,
      });

      const permission = await GroupMembership.scope("withCollection").findOne({
        where: {
          groupId: group.id,
          collectionId: collection.id,
        },
      });

      expect(permission).toBeDefined();
      expect(permission?.collection).toBeDefined();
      expect(permission?.collection?.id).toEqual(collection.id);
    });
  });

  describe("guest cap", () => {
    it("should reject an admin membership for a group containing a guest", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const guest = await buildGuestUser({ teamId: team.id });
      const collection = await buildCollection({ teamId: team.id });
      const group = await buildGroup({
        teamId: team.id,
        createdById: admin.id,
      });
      await GroupUser.create({
        groupId: group.id,
        userId: guest.id,
        createdById: admin.id,
      });

      await expect(
        GroupMembership.create({
          createdById: admin.id,
          collectionId: collection.id,
          groupId: group.id,
          permission: CollectionPermission.Admin,
        })
      ).rejects.toThrow("Guests cannot be granted manage permissions");
    });

    it("should allow a read_write membership for a group containing a guest", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const guest = await buildGuestUser({ teamId: team.id });
      const collection = await buildCollection({ teamId: team.id });
      const group = await buildGroup({
        teamId: team.id,
        createdById: admin.id,
      });
      await GroupUser.create({
        groupId: group.id,
        userId: guest.id,
        createdById: admin.id,
      });

      const membership = await GroupMembership.create({
        createdById: admin.id,
        collectionId: collection.id,
        groupId: group.id,
        permission: CollectionPermission.ReadWrite,
      });

      expect(membership.permission).toEqual(CollectionPermission.ReadWrite);
    });
  });
});
