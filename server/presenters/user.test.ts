import { NotificationEventType, UserPreference, UserRole } from "@shared/types";
import { User } from "@server/models";
import presentUser from "./user";

it("presents the invite expiry for a pending invite", () => {
  const user = User.build({
    id: "123",
    name: "Guest",
    role: UserRole.Guest,
    inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
  });

  expect(presentUser(user).inviteExpiresAt).toEqual(
    new Date("2018-01-08T00:00:00.000Z")
  );
});

it("presents a null expiry for a user with no invite", () => {
  const user = User.build({ id: "123", name: "Member" });

  expect(presentUser(user).inviteExpiresAt).toBeNull();
});

it("presents a user", async () => {
  const user = presentUser(
    User.build({
      id: "123",
      name: "Test User",
    })
  );
  expect(user).toMatchSnapshot();
});

it("presents a user without slack data", async () => {
  const user = presentUser(
    User.build({
      id: "123",
      name: "Test User",
    })
  );
  expect(user).toMatchSnapshot();
});

it("omits unrecognized preferences and notification settings", async () => {
  const user = User.build({ id: "123", name: "Test User" });
  user.preferences = JSON.parse(
    '{"seamlessEdit":true,"unknownPreference":true}'
  );
  user.notificationSettings = JSON.parse(
    '{"documents.publish":true,"unknown.event":true}'
  );

  const data = presentUser(user, { includeDetails: true });
  expect(data.preferences).toEqual({
    [UserPreference.SeamlessEdit]: true,
  });
  expect(data.notificationSettings).toEqual({
    [NotificationEventType.PublishDocument]: true,
  });
});
