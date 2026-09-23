import { randomUUID } from "node:crypto";
import type { Context } from "koa";
import { getBaseDomain, parseDomain } from "@shared/utils/domains";
import env from "@server/env";
import { Team } from "@server/models";
import { buildTeam, buildUser } from "@server/test/factories";
import {
  isVaultMode,
  isVaultRequest,
  isVaultSignIn,
  issueVaultEmailToken,
  issueVaultSession,
  resetVaultModeCache,
  routeVaultSignIn,
  setVaultSessionCookie,
  verifyVaultEmailToken,
  verifyVaultSession,
} from "./vault";

function mockCtx(hostname: string, oauthStateHost?: string) {
  const store: Record<string, string> = {};
  const options: Record<string, unknown> = {};

  const ctx = {
    hostname,
    state: oauthStateHost ? { oauthState: { host: oauthStateHost } } : {},
    cookies: {
      get: (name: string) => store[name],
      set: (name: string, value: string, opts?: unknown) => {
        store[name] = value;
        options[name] = opts;
      },
    },
  } as unknown as Context;

  return { ctx, store, options };
}

const slug = () => randomUUID().split("-")[0];
const apex = () => parseDomain(env.URL).host;

beforeEach(() => {
  resetVaultModeCache();
});

describe("isVaultMode", () => {
  function mockTeamCounts(total: number, withoutSubdomain: number) {
    return vi.spyOn(Team, "count").mockImplementation(async (options) => {
      const filtered = !!options?.where;
      return filtered ? withoutSubdomain : total;
    });
  }

  it("is false when a team owns the apex", async () => {
    const spy = mockTeamCounts(3, 1);
    expect(await isVaultMode()).toBe(false);
    spy.mockRestore();
  });

  it("is true when every team has a subdomain", async () => {
    const spy = mockTeamCounts(2, 0);
    expect(await isVaultMode()).toBe(true);
    spy.mockRestore();
  });

  it("is false with no teams at all", async () => {
    const spy = mockTeamCounts(0, 0);
    expect(await isVaultMode()).toBe(false);
    spy.mockRestore();
  });
});

describe("isVaultRequest", () => {
  function mockVaultMode() {
    return vi.spyOn(Team, "count").mockImplementation(async (options) => {
      const filtered = !!options?.where;
      return filtered ? 0 : 2;
    });
  }

  it("is true on the apex in vault mode", async () => {
    const spy = mockVaultMode();
    const { ctx } = mockCtx(apex());
    expect(await isVaultRequest(ctx)).toBe(true);
    spy.mockRestore();
  });

  it("is false on a tenant subdomain", async () => {
    const spy = mockVaultMode();
    const { ctx } = mockCtx(`tin.${getBaseDomain()}`);
    expect(await isVaultRequest(ctx)).toBe(false);
    spy.mockRestore();
  });

  it("is false on a custom domain", async () => {
    const spy = mockVaultMode();
    const { ctx } = mockCtx("docs.example.org");
    expect(await isVaultRequest(ctx)).toBe(false);
    spy.mockRestore();
  });
});

describe("isVaultSignIn", () => {
  function mockVaultMode() {
    return vi.spyOn(Team, "count").mockImplementation(async (options) => {
      const filtered = !!options?.where;
      return filtered ? 0 : 2;
    });
  }

  it("is true for a sign-in started on the apex", async () => {
    const spy = mockVaultMode();
    const { ctx } = mockCtx(apex(), apex());
    expect(await isVaultSignIn(ctx)).toBe(true);
    spy.mockRestore();
  });

  it("is false for a sign-in started on an existing tenant", async () => {
    const team = await buildTeam({ subdomain: slug() });
    const spy = mockVaultMode();
    const { ctx } = mockCtx(apex(), `${team.subdomain}.${getBaseDomain()}`);
    expect(await isVaultSignIn(ctx)).toBe(false);
    spy.mockRestore();
  });

  it("is true for a sign-in started on an unknown tenant", async () => {
    const spy = mockVaultMode();
    const { ctx } = mockCtx(apex(), `${slug()}.${getBaseDomain()}`);
    expect(await isVaultSignIn(ctx)).toBe(true);
    spy.mockRestore();
  });

  it("is false off the apex", async () => {
    const spy = mockVaultMode();
    const { ctx } = mockCtx(`tin.${getBaseDomain()}`);
    expect(await isVaultSignIn(ctx)).toBe(false);
    spy.mockRestore();
  });
});

describe("routeVaultSignIn", () => {
  it("resolves a single membership to that team", async () => {
    const email = `${slug()}@tin.info`;
    const team = await buildTeam({ subdomain: slug() });
    const user = await buildUser({ teamId: team.id, email });
    const { ctx } = mockCtx(apex());

    const outcome = await routeVaultSignIn(ctx, "google", email);

    expect(outcome.kind).toBe("single");
    if (outcome.kind === "single") {
      expect(outcome.user.id).toBe(user.id);
      expect(outcome.team.id).toBe(team.id);
    }
  });

  it("returns choice and sets a vault cookie for several memberships", async () => {
    const email = `${slug()}@tin.info`;
    const teamA = await buildTeam({ subdomain: slug() });
    const teamB = await buildTeam({ subdomain: slug() });
    await buildUser({ teamId: teamA.id, email });
    await buildUser({ teamId: teamB.id, email });
    const { ctx, store } = mockCtx(apex());

    const outcome = await routeVaultSignIn(ctx, "google", email);

    expect(outcome.kind).toBe("choice");
    expect(store["vaultSession"]).toBeTruthy();
  });

  it("returns none and sets a vault cookie with no memberships", async () => {
    const email = `${slug()}@tin.info`;
    await buildTeam({ subdomain: slug() });
    const { ctx, store } = mockCtx(apex());

    const outcome = await routeVaultSignIn(ctx, "google", email);

    expect(outcome.kind).toBe("none");
    expect(store["vaultSession"]).toBeTruthy();
  });

  it("ignores suspended accounts", async () => {
    const email = `${slug()}@tin.info`;
    const teamA = await buildTeam({ subdomain: slug() });
    const teamB = await buildTeam({ subdomain: slug() });
    await buildUser({ teamId: teamA.id, email });
    await buildUser({ teamId: teamB.id, email, suspendedAt: new Date() });
    const { ctx } = mockCtx(apex());

    const outcome = await routeVaultSignIn(ctx, "google", email);

    expect(outcome.kind).toBe("single");
  });
});

describe("vault session cookie", () => {
  it("round trips email and service", () => {
    const { ctx, store } = mockCtx(apex());
    setVaultSessionCookie(ctx, "mira@tin.info", "azure");

    expect(verifyVaultSession(ctx)).toEqual({
      email: "mira@tin.info",
      service: "azure",
    });
    expect(store["vaultSession"]).toBeTruthy();
  });

  it("is host-only so tenant subdomains never receive it", () => {
    const { ctx, options } = mockCtx(apex());
    setVaultSessionCookie(ctx, "mira@tin.info", "azure");

    expect(options["vaultSession"]).not.toHaveProperty("domain");
  });

  it("rejects garbage tokens", () => {
    const { ctx, store } = mockCtx(apex());
    store["vaultSession"] = "not-a-jwt";

    expect(verifyVaultSession(ctx)).toBeUndefined();
  });
});

describe("vault email token", () => {
  it("round trips the email", () => {
    expect(verifyVaultEmailToken(issueVaultEmailToken("mira@tin.info"))).toBe(
      "mira@tin.info"
    );
  });

  it("rejects tokens of other types", () => {
    expect(
      verifyVaultEmailToken(issueVaultSession("mira@tin.info", "email"))
    ).toBeUndefined();
  });
});
