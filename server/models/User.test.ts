import { faker } from "@faker-js/faker";
import { errToString } from "@shared/utils/error";
import { CollectionPermission, UserRole } from "@shared/types";
import { createContext } from "@server/context";
import { Event } from "@server/models";
import { sequelize } from "@server/storage/database";
import { getJWTPayload } from "@server/utils/jwt";
import {
  buildUser,
  buildTeam,
  buildCollection,
  buildAdmin,
  buildViewer,
  buildGuestUser,
  buildInvite,
} from "@server/test/factories";
import User, { UserFlag } from "./User";
import UserMembership from "./UserMembership";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2018-01-02T00:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("user model", () => {
  describe("createWithCtx", () => {
    it("should create an event with the new user as both actorId and userId", async () => {
      const team = await buildTeam();
      const email = faker.internet.email().toLowerCase();
      const name = faker.person.fullName();
      const ip = "127.0.0.1";

      const user = await sequelize.transaction(async (transaction) =>
        User.createWithCtx(createContext({ ip, transaction }), {
          email,
          name,
          teamId: team.id,
        })
      );

      const event = await Event.findOne({
        where: {
          name: "users.create",
          modelId: user.id,
        },
      });

      expect(event).toBeDefined();
      expect(event?.actorId).toEqual(user.id);
      expect(event?.userId).toEqual(user.id);
      expect(event?.teamId).toEqual(user.teamId);
      expect(event?.ip).toEqual(ip);
    });
  });

  describe("create", () => {
    it("should not allow URLs in name", async () => {
      await expect(
        buildUser({
          name: "www.google.com",
        })
      ).rejects.toThrow();

      await expect(
        buildUser({
          name: "My name https://malicious.com",
        })
      ).rejects.toThrow();

      await expect(
        buildUser({
          name: "wwwww",
        })
      ).resolves.toBeDefined();
    });
  });

  describe("ip setters", () => {
    it("normalizes lastActiveIp and lastSignedInIp on assignment", async () => {
      const user = await buildUser();

      user.lastActiveIp = "::ffff:127.0.0.1";
      user.lastSignedInIp = "203.0.113.1, 70.41.3.18";
      await user.save({ hooks: false });

      expect(user.lastActiveIp).toBe("127.0.0.1");
      expect(user.lastSignedInIp).toBe("203.0.113.1");
    });

    it("nulls out invalid IP values without failing validation", async () => {
      const user = await buildUser();

      user.lastActiveIp = "unknown";
      user.lastSignedInIp = "not-an-ip";
      await expect(user.save({ hooks: false })).resolves.toBeDefined();

      expect(user.lastActiveIp).toBeNull();
      expect(user.lastSignedInIp).toBeNull();
    });
  });

  describe("destroy", () => {
    it("should clear PII", async () => {
      const user = await buildUser();

      await buildUser({
        teamId: user.teamId,
      });

      await user.destroy();
      expect(user.email).toBe(null);
      expect(user.name).toBe("Unknown");
    });

    it("should prevent last user from deleting account", async () => {
      const user = await buildUser();
      let error;

      try {
        await user.destroy();
      } catch (err) {
        error = err;
      }

      expect(errToString(error)).toContain("Cannot delete last user");
    });

    it("should prevent last admin from deleting account", async () => {
      const user = await buildAdmin();
      await buildUser({
        teamId: user.teamId,
      });
      let error;

      try {
        await user.destroy();
      } catch (err) {
        error = err;
      }

      expect(errToString(error)).toContain("Cannot delete account");
    });

    it("should not prevent multiple admin from deleting account", async () => {
      const actor = await buildAdmin();
      const user = await buildAdmin({
        teamId: actor.teamId,
      });
      let error;

      try {
        await user.destroy();
      } catch (err) {
        error = err;
      }

      expect(error).toBeFalsy();
      expect(user.deletedAt).toBeTruthy();
    });

    it("should not prevent last non-admin from deleting account", async () => {
      const user = await buildUser();
      await buildUser({
        teamId: user.teamId,
      });
      let error;

      try {
        await user.destroy();
      } catch (err) {
        error = err;
      }

      expect(error).toBeFalsy();
      expect(user.deletedAt).toBeTruthy();
    });
  });

  describe("getSessionToken", () => {
    it("should set JWT secret", async () => {
      const user = await buildUser();
      expect(user.getSessionToken()).toBeTruthy();
    });
  });

  describe("availableTeams", () => {
    it("should return teams where another user with the same email exists", async () => {
      const email = faker.internet.email().toLowerCase();
      const user = await buildUser({
        email,
      });
      const anotherUser = await buildUser({ email });

      const response = await user.availableTeams();
      const teamIds = response.map((t) => t.id).sort();
      const expectedTeamIds = [user.teamId, anotherUser.teamId].sort();
      expect(teamIds).toEqual(expectedTeamIds);
    });
  });

  describe("collectionIds", () => {
    it("should return read_write collections", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.ReadWrite,
      });
      const response = await user.collectionIds();
      expect(response.length).toEqual(1);
      expect(response[0]).toEqual(collection.id);
    });

    it("should return read collections", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Read,
      });
      const response = await user.collectionIds();
      expect(response.length).toEqual(1);
      expect(response[0]).toEqual(collection.id);
    });

    it("should not return a cached response after a role change", async () => {
      const team = await buildTeam();
      const user = await buildGuestUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.ReadWrite,
      });
      expect(await user.collectionIds()).toEqual([]);

      await user.update({ role: UserRole.Member });

      expect(await user.collectionIds()).toEqual([collection.id]);
    });

    it("should not return private collections", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const response = await user.collectionIds();
      expect(response.length).toEqual(0);
    });

    it("should not return private collection with membership", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      await UserMembership.create({
        createdById: user.id,
        collectionId: collection.id,
        userId: user.id,
        permission: CollectionPermission.Read,
      });
      const response = await user.collectionIds();
      expect(response.length).toEqual(1);
      expect(response[0]).toEqual(collection.id);
    });
  });

  describe("updateMembershipPermissions", () => {
    it("should downgrade permissions when demoting Admin to Viewer", async () => {
      const admin = await buildAdmin();
      // Ensure there's another admin so we can demote this one
      await buildAdmin({ teamId: admin.teamId });
      const collection = await buildCollection({
        teamId: admin.teamId,
        permission: null,
      });
      await UserMembership.create({
        createdById: admin.id,
        collectionId: collection.id,
        userId: admin.id,
        permission: CollectionPermission.ReadWrite,
      });

      await sequelize.transaction(async (transaction) => {
        await admin.update({ role: UserRole.Viewer }, { transaction });
      });

      const membership = await UserMembership.findOne({
        where: { userId: admin.id, collectionId: collection.id },
      });
      expect(membership?.permission).toEqual(CollectionPermission.Read);
    });

    it("should downgrade permissions when demoting Admin to Guest", async () => {
      const admin = await buildAdmin();
      // Ensure there's another admin so we can demote this one
      await buildAdmin({ teamId: admin.teamId });
      const collection = await buildCollection({
        teamId: admin.teamId,
        permission: null,
      });
      await UserMembership.create({
        createdById: admin.id,
        collectionId: collection.id,
        userId: admin.id,
        permission: CollectionPermission.ReadWrite,
      });

      await sequelize.transaction(async (transaction) => {
        await admin.update({ role: UserRole.Guest }, { transaction });
      });

      const membership = await UserMembership.findOne({
        where: { userId: admin.id, collectionId: collection.id },
      });
      expect(membership?.permission).toEqual(CollectionPermission.Read);
    });

    it("should downgrade permissions when demoting Member to Viewer", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      await UserMembership.create({
        createdById: user.id,
        collectionId: collection.id,
        userId: user.id,
        permission: CollectionPermission.ReadWrite,
      });

      await sequelize.transaction(async (transaction) => {
        await user.update({ role: UserRole.Viewer }, { transaction });
      });

      const membership = await UserMembership.findOne({
        where: { userId: user.id, collectionId: collection.id },
      });
      expect(membership?.permission).toEqual(CollectionPermission.Read);
    });

    it("should downgrade permissions when demoting Member to Guest", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      await UserMembership.create({
        createdById: user.id,
        collectionId: collection.id,
        userId: user.id,
        permission: CollectionPermission.ReadWrite,
      });

      await sequelize.transaction(async (transaction) => {
        await user.update({ role: UserRole.Guest }, { transaction });
      });

      const membership = await UserMembership.findOne({
        where: { userId: user.id, collectionId: collection.id },
      });
      expect(membership?.permission).toEqual(CollectionPermission.Read);
    });

    it("should downgrade permissions when demoting Viewer to Guest", async () => {
      const viewer = await buildViewer();
      const collection = await buildCollection({
        teamId: viewer.teamId,
        permission: null,
      });
      await UserMembership.create({
        createdById: viewer.id,
        collectionId: collection.id,
        userId: viewer.id,
        permission: CollectionPermission.ReadWrite,
      });

      await sequelize.transaction(async (transaction) => {
        await viewer.update({ role: UserRole.Guest }, { transaction });
      });

      const membership = await UserMembership.findOne({
        where: { userId: viewer.id, collectionId: collection.id },
      });
      expect(membership?.permission).toEqual(CollectionPermission.Read);
    });

    it("should not downgrade permissions when promoting Guest to Viewer", async () => {
      const guest = await buildGuestUser();
      const collection = await buildCollection({
        teamId: guest.teamId,
        permission: null,
      });
      await UserMembership.create({
        createdById: guest.id,
        collectionId: collection.id,
        userId: guest.id,
        permission: CollectionPermission.ReadWrite,
      });

      await sequelize.transaction(async (transaction) => {
        await guest.update({ role: UserRole.Viewer }, { transaction });
      });

      const membership = await UserMembership.findOne({
        where: { userId: guest.id, collectionId: collection.id },
      });
      expect(membership?.permission).toEqual(CollectionPermission.ReadWrite);
    });

    it("should not downgrade permissions when promoting Viewer to Member", async () => {
      const viewer = await buildViewer();
      const collection = await buildCollection({
        teamId: viewer.teamId,
        permission: null,
      });
      await UserMembership.create({
        createdById: viewer.id,
        collectionId: collection.id,
        userId: viewer.id,
        permission: CollectionPermission.Read,
      });

      await sequelize.transaction(async (transaction) => {
        await viewer.update({ role: UserRole.Member }, { transaction });
      });

      const membership = await UserMembership.findOne({
        where: { userId: viewer.id, collectionId: collection.id },
      });
      expect(membership?.permission).toEqual(CollectionPermission.Read);
    });

    it("should not downgrade permissions when demoting Admin to Member", async () => {
      const admin = await buildAdmin();
      // Ensure there's another admin so we can demote this one
      await buildAdmin({ teamId: admin.teamId });
      const collection = await buildCollection({
        teamId: admin.teamId,
        permission: null,
      });
      await UserMembership.create({
        createdById: admin.id,
        collectionId: collection.id,
        userId: admin.id,
        permission: CollectionPermission.ReadWrite,
      });

      await sequelize.transaction(async (transaction) => {
        await admin.update({ role: UserRole.Member }, { transaction });
      });

      const membership = await UserMembership.findOne({
        where: { userId: admin.id, collectionId: collection.id },
      });
      expect(membership?.permission).toEqual(CollectionPermission.ReadWrite);
    });
  });

  describe("invite lifecycle", () => {
    afterEach(() => {
      vi.setSystemTime(new Date("2018-01-02T00:00:00.000Z"));
    });

    it("expires a guest invite after seven days", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
      });

      // The suite pins the clock to 2018-01-02, so this is one day old.
      expect(user.isInviteExpired()).toBe(false);

      vi.setSystemTime(new Date("2018-01-09T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(true);
    });

    it("keeps a member invite live for thirty days", async () => {
      const user = await buildInvite({
        role: UserRole.Member,
        inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
      });

      vi.setSystemTime(new Date("2018-01-20T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(false);
      vi.setSystemTime(new Date("2018-02-05T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(true);
    });

    it("never expires an invite once it has been accepted", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
      });
      user.lastActiveAt = new Date("2018-01-03T00:00:00.000Z");

      vi.setSystemTime(new Date("2018-03-01T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(false);
    });

    it("never expires an invite that was never sent", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: null,
      });

      vi.setSystemTime(new Date("2019-01-01T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(false);
    });

    it("signs a guest token that dies with the window, not at thirty days", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: new Date("2018-01-02T00:00:00.000Z"),
      });

      const payload = getJWTPayload(user.getInviteToken());
      const expiresAt = new Date((payload.exp as number) * 1000);

      expect(expiresAt.toISOString()).toBe("2018-01-09T00:00:00.000Z");
    });

    it("keeps the thirty day token for a user with no clock", async () => {
      const user = await buildInvite({
        role: UserRole.Member,
        inviteLastSentAt: null,
      });

      const payload = getJWTPayload(user.getInviteToken());
      const expiresAt = new Date((payload.exp as number) * 1000);

      expect(expiresAt.toISOString()).toBe("2018-02-01T00:00:00.000Z");
    });

    it("restarts the lifecycle, keeping the send count", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
      });
      user.incrementFlag(UserFlag.InviteReminderSent, 3);
      user.setFlag(UserFlag.InviteExpiryNotified, true);
      const sends = user.getFlag(UserFlag.InviteSent);

      user.restartInviteLifecycle();

      // The suite pins the clock to 2018-01-02.
      expect(user.inviteLastSentAt).toEqual(
        new Date("2018-01-02T00:00:00.000Z")
      );
      expect(user.getFlag(UserFlag.InviteReminderSent)).toBe(0);
      expect(user.getFlag(UserFlag.InviteExpiryNotified)).toBe(0);
      expect(user.getFlag(UserFlag.InviteSent)).toBe(sends + 1);
    });
  });
});
