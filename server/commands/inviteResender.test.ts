import { subHours } from "date-fns";
import { InviteMaxSends } from "@shared/constants";
import { CollectionPermission, UserRole } from "@shared/types";
import GuestInviteEmail from "@server/emails/templates/GuestInviteEmail";
import InviteEmail from "@server/emails/templates/InviteEmail";
import { User, UserMembership } from "@server/models";
import { UserFlag } from "@server/models/User";
import {
  buildAdmin,
  buildCollection,
  buildGuestUser,
  buildInvite,
  buildUser,
  buildViewer,
} from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import inviteResender from "./inviteResender";

const hoursAgo = (hours: number) => subHours(new Date(), hours);

/** A guest with an outstanding invite, aged by the given hours. */
const buildPendingGuest = (hours: number) =>
  buildInvite({ role: UserRole.Guest, inviteLastSentAt: hoursAgo(hours) });

describe("inviteResender", () => {
  it("resends a guest invite as a guest email and reopens the window", async () => {
    const guest = await buildPendingGuest(200);
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });
    const spy = vi.spyOn(GuestInviteEmail.prototype, "schedule");

    await withAPIContext(admin, (ctx) => inviteResender(ctx, { user: guest }));
    await guest.reload();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(guest.isInviteExpired()).toBe(false);
    expect(guest.getFlag(UserFlag.InviteReminderSent)).toBe(0);
    expect(guest.getFlag(UserFlag.InviteExpiryNotified)).toBe(0);
    spy.mockRestore();
  });

  it("resends a member invite as the workspace email", async () => {
    const member = await buildInvite({
      role: UserRole.Member,
      inviteLastSentAt: hoursAgo(200),
    });
    const admin = await buildAdmin({ teamId: member.teamId });
    const spy = vi.spyOn(InviteEmail.prototype, "schedule");

    await withAPIContext(admin, (ctx) => inviteResender(ctx, { user: member }));

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refuses a second resend inside the cooldown", async () => {
    // Two hours, not one: the cooldown is 24 hours, and a one-hour-old invite
    // would also be refused by a one-hour cooldown, so it proves nothing.
    const guest = await buildPendingGuest(2);
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });

    await expect(
      withAPIContext(admin, (ctx) => inviteResender(ctx, { user: guest }))
    ).rejects.toThrow(/recently/);
  });

  it("allows a resend once the cooldown has elapsed", async () => {
    const guest = await buildPendingGuest(25);
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });
    const spy = vi.spyOn(GuestInviteEmail.prototype, "schedule");

    await withAPIContext(admin, (ctx) => inviteResender(ctx, { user: guest }));

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refuses once the send ceiling is reached", async () => {
    const guest = await buildPendingGuest(200);
    guest.setFlag(UserFlag.InviteSent, false);
    for (let i = 0; i < InviteMaxSends; i++) {
      guest.incrementFlag(UserFlag.InviteSent);
    }
    await guest.save();
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });

    await expect(
      withAPIContext(admin, (ctx) => inviteResender(ctx, { user: guest }))
    ).rejects.toThrow(/too many times/);
  });

  it("allows a manager of a shared item to resend", async () => {
    const guest = await buildPendingGuest(200);
    const manager = await buildUser({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: manager.id,
    });
    await UserMembership.create({
      userId: manager.id,
      collectionId: collection.id,
      permission: CollectionPermission.Admin,
      createdById: manager.id,
    });
    const spy = vi.spyOn(GuestInviteEmail.prototype, "schedule");

    await withAPIContext(manager, (ctx) =>
      inviteResender(ctx, { user: guest })
    );

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refuses an unrelated member", async () => {
    const guest = await buildPendingGuest(200);
    const stranger = await buildViewer({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: stranger.id,
    });

    await expect(
      withAPIContext(stranger, (ctx) => inviteResender(ctx, { user: guest }))
    ).rejects.toThrow(/Authorization/);
  });

  it("refuses a guest trying to resend", async () => {
    const guest = await buildPendingGuest(200);
    const other = await buildGuestUser({ teamId: guest.teamId });

    await expect(
      withAPIContext(other, (ctx) => inviteResender(ctx, { user: guest }))
    ).rejects.toThrow(/Authorization/);
  });

  it("counts the resend against the send total", async () => {
    const guest = await buildPendingGuest(200);
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });
    const before = guest.getFlag(UserFlag.InviteSent);

    await withAPIContext(admin, (ctx) => inviteResender(ctx, { user: guest }));
    await guest.reload();

    expect(guest.getFlag(UserFlag.InviteSent)).toBe(before + 1);
  });
});
