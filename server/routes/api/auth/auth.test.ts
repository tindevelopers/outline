import { faker } from "@faker-js/faker";
import { randomUUID } from "node:crypto";
import { Scope, TeamPreference } from "@shared/types";
import { getBaseDomain, parseDomain } from "@shared/utils/domains";
import env from "@server/env";
import { Team } from "@server/models";
import { resetVaultModeCache } from "@server/utils/vault";
import {
  buildApiKey,
  buildOAuthAuthentication,
  buildUser,
  buildTeam,
  buildUserPasskey,
} from "@server/test/factories";
import { getTestServer, setSelfHosted } from "@server/test/support";

const mockTeamInSessionId = randomUUID();

vi.mock("@server/utils/authentication", () => ({
  getSessionsInCookie() {
    return { [mockTeamInSessionId]: {} };
  },
}));

const server = getTestServer();

describe("#auth.info", () => {
  it("should return current authentication", async () => {
    const team = await buildTeam();
    const team2 = await buildTeam();
    const team3 = await buildTeam({
      id: mockTeamInSessionId,
    });

    const user = await buildUser({ teamId: team.id });
    await buildUser();
    await buildUser({
      teamId: team2.id,
      email: user.email,
    });
    const res = await server.post("/api/auth.info", user);
    const body = await res.json();
    expect(res.status).toEqual(200);

    const availableTeamIds = body.data.availableTeams.map(
      (t: { id: string }) => t.id
    );

    expect(availableTeamIds.length).toEqual(3);
    expect(availableTeamIds).toContain(team.id);
    expect(availableTeamIds).toContain(team2.id);
    expect(availableTeamIds).toContain(team3.id);
    expect(body.data.user.name).toBe(user.name);
    expect(body.data.team.name).toBe(team.name);
    expect(body.data.team.allowedDomains).toEqual([]);
  });

  it("should return a collaboration token for a session", async () => {
    const user = await buildUser();
    const res = await server.post("/api/auth.info", user);
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeTruthy();
  });

  it("should not return a collaboration token for an API key", async () => {
    const user = await buildUser();
    const key = await buildApiKey({ userId: user.id });
    const res = await server.post("/api/auth.info", {
      headers: {
        Authorization: `Bearer ${key.value}`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeUndefined();
  });

  it("should not return a collaboration token for an OAuth access token", async () => {
    const user = await buildUser();
    const authentication = await buildOAuthAuthentication({
      user,
      scope: [Scope.Read],
    });
    const res = await server.post("/api/auth.info", {
      headers: {
        Authorization: `Bearer ${authentication.accessToken}`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeUndefined();
  });

  it("should require the team to not be deleted", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    await team.destroy();
    const res = await server.post("/api/auth.info", user);
    expect(res.status).toEqual(401);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/auth.info");
    expect(res.status).toEqual(401);
  });
});

describe("#auth.delete", () => {
  it("should make the access token unusable", async () => {
    const user = await buildUser();
    const res = await server.post("/api/auth.delete", user);
    expect(res.status).toEqual(200);

    const res2 = await server.post("/api/auth.info", user);
    expect(res2.status).toEqual(401);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/auth.delete");
    expect(res.status).toEqual(401);
  });
});

describe("#auth.config", () => {
  it("should return available SSO providers", async () => {
    const res = await server.post("/api/auth.config");
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(3);
    expect(body.data.providers[0].name).toBe("Slack");
    expect(body.data.providers[1].name).toBe("OpenID Connect");
    expect(body.data.providers[2].name).toBe("Google");
  });

  it("should return available providers for team subdomain", async () => {
    const subdomain = faker.internet.domainWord();
    await buildTeam({
      guestSignin: false,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(1);
    expect(body.data.providers[0].name).toBe("Slack");
  });

  it("should return available providers for team custom domain", async () => {
    const domain = faker.internet.domainName();
    await buildTeam({
      guestSignin: false,
      domain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: domain,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(1);
    expect(body.data.providers[0].name).toBe("Slack");
  });

  it("should return email provider for team when guest signin enabled", async () => {
    const subdomain = faker.internet.domainWord();
    await buildTeam({
      guestSignin: true,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(2);
    expect(body.data.providers[0].name).toBe("Slack");
    expect(body.data.providers[1].name).toBe("Email");
  });

  it("should not return provider when disabled", async () => {
    const subdomain = faker.internet.domainWord();
    await buildTeam({
      guestSignin: false,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
          enabled: false,
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(0);
  });

  it("should not return passkeys provider when passkeysEnabled but no passkeys exist", async () => {
    const subdomain = faker.internet.domainWord();
    await buildTeam({
      guestSignin: false,
      passkeysEnabled: true,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(1);
    expect(body.data.providers[0].name).toBe("Slack");
  });

  it("should return passkeys provider when passkeysEnabled and passkeys exist", async () => {
    const subdomain = faker.internet.domainWord();
    const team = await buildTeam({
      guestSignin: false,
      passkeysEnabled: true,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const user = await buildUser({ teamId: team.id });
    await buildUserPasskey({ userId: user.id });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(2);
    expect(body.data.providers[0].name).toBe("Slack");
    expect(body.data.providers[1].name).toBe("Passkeys");
  });

  describe.skip("self hosted", () => {
    beforeEach(setSelfHosted);

    it("should return all configured providers but respect email setting", async () => {
      await buildTeam({
        guestSignin: false,
        authenticationProviders: [
          {
            name: "slack",
            providerId: randomUUID(),
          },
        ],
      });
      const res = await server.post("/api/auth.config");
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.data.providers.length).toBe(3);
      expect(body.data.providers[0].name).toBe("Google");
      expect(body.data.providers[1].name).toBe("OpenID Connect");
      expect(body.data.providers[2].name).toBe("Slack");
    });

    it("should return email provider for team when guest signin enabled", async () => {
      await buildTeam({
        guestSignin: true,
        authenticationProviders: [
          {
            name: "slack",
            providerId: randomUUID(),
          },
        ],
      });
      const res = await server.post("/api/auth.config");
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.data.providers.length).toBe(4);
      expect(body.data.providers[0].name).toBe("Slack");
      expect(body.data.providers[1].name).toBe("OpenID Connect");
      expect(body.data.providers[2].name).toBe("Google");
      expect(body.data.providers[3].name).toBe("Email");
    });
  });
});

describe("#auth.config (vault mode)", () => {
  const slug = () => randomUUID().split("-")[0];

  beforeEach(() => {
    // The global setup resets env.URL to the cloud host before every test.
    setSelfHosted();
    resetVaultModeCache();
  });

  function mockVaultMode(enabled: boolean) {
    return vi.spyOn(Team, "count").mockImplementation(async (options) => {
      const filtered = !!options?.where;
      if (enabled) {
        return filtered ? 0 : 2;
      }
      return filtered ? 1 : 3;
    });
  }

  it("returns the vault flag and no team name on the apex", async () => {
    const spy = mockVaultMode(true);
    const res = await server.post("/api/auth.config", {
      headers: { host: parseDomain(env.URL).host },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.vault).toBe(true);
    expect(body.data.name).toBeUndefined();
    expect(Array.isArray(body.data.providers)).toBe(true);
    spy.mockRestore();
  });

  it("gates tenant name behind PublicBranding", async () => {
    const team = await buildTeam({ subdomain: slug() });
    const host = `${team.subdomain}.${getBaseDomain()}`;

    let res = await server.post("/api/auth.config", { headers: { host } });
    let body = await res.json();
    expect(body.data.name).toBeUndefined();

    team.setPreference(TeamPreference.PublicBranding, true);
    await team.save();
    res = await server.post("/api/auth.config", { headers: { host } });
    body = await res.json();
    expect(body.data.name).toEqual(team.name);
  });

  it("reports unknown tenant subdomains without team details", async () => {
    const spy = mockVaultMode(true);
    const res = await server.post("/api/auth.config", {
      headers: { host: `missing-${slug()}.${getBaseDomain()}` },
    });
    const body = await res.json();
    expect(body.data.workspaceNotFound).toBe(true);
    expect(body.data.name).toBeUndefined();
    expect(body.data.vault).toBeUndefined();
    spy.mockRestore();
  });

  it("keeps legacy apex branding for single-team installs", async () => {
    const team = await buildTeam({ domain: parseDomain(env.URL).host });
    const spy = mockVaultMode(false);
    const res = await server.post("/api/auth.config", {
      headers: { host: parseDomain(env.URL).host },
    });
    const body = await res.json();
    expect(body.data.vault).toBeUndefined();
    expect(body.data.name).toEqual(team.name);
    spy.mockRestore();
  });
});
