import { randomUUID } from "node:crypto";
import { buildTeam, buildUser } from "@server/test/factories";
import { getTestServer, setSelfHosted } from "@server/test/support";
import { issueVaultSession } from "@server/utils/vault";

const server = getTestServer();

const slug = () => randomUUID().split("-")[0];

function vaultCookie(email: string) {
  return { cookie: `vaultSession=${issueVaultSession(email, "google")}` };
}

beforeEach(() => {
  setSelfHosted();
});

describe("#vault.workspaces", () => {
  it("should require a vault session or token", async () => {
    const res = await server.post("/api/vault.workspaces");
    expect(res.status).toEqual(403);
  });

  it("should return only the caller's memberships", async () => {
    const email = `${slug()}@tin.info`;
    const teamA = await buildTeam({ subdomain: slug(), name: "Programming" });
    const teamB = await buildTeam({ subdomain: slug(), name: "Clients" });
    const stranger = await buildTeam({ subdomain: slug() });
    await buildUser({ teamId: teamA.id, email });
    await buildUser({ teamId: teamB.id, email });
    await buildUser({ teamId: stranger.id });

    const res = await server.post("/api/vault.workspaces", {
      headers: vaultCookie(email),
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.email).toEqual(email);
    expect(body.data.workspaces).toHaveLength(2);
    const slugs = body.data.workspaces.map(
      (workspace: { slug: string }) => workspace.slug
    );
    expect(slugs).toContain(teamA.subdomain);
    expect(slugs).toContain(teamB.subdomain);
    expect(slugs).not.toContain(stranger.subdomain);
    expect(body.data.workspaces[0].url).toContain(".");
  });

  it("should return an empty list with no memberships", async () => {
    const email = `${slug()}@tin.info`;
    await buildTeam({ subdomain: slug() });

    const res = await server.post("/api/vault.workspaces", {
      headers: vaultCookie(email),
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.workspaces).toEqual([]);
  });
});

describe("#vault.transfer", () => {
  it("should mint a transfer url for a member team", async () => {
    const email = `${slug()}@tin.info`;
    const team = await buildTeam({ subdomain: slug() });
    await buildUser({ teamId: team.id, email });

    const res = await server.post("/api/vault.transfer", {
      headers: vaultCookie(email),
      body: { teamId: team.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.url).toContain(team.url);
    expect(body.data.url).toContain("/auth/redirect?token=");
  });

  it("should refuse teams the identity does not belong to", async () => {
    const email = `${slug()}@tin.info`;
    const team = await buildTeam({ subdomain: slug() });
    await buildTeam({ subdomain: slug() });

    const res = await server.post("/api/vault.transfer", {
      headers: vaultCookie(email),
      body: { teamId: team.id },
    });
    expect(res.status).toEqual(403);
  });

  it("should refuse custom domain teams", async () => {
    const email = `${slug()}@tin.info`;
    const team = await buildTeam({ subdomain: slug(), domain: `${slug()}.example.com` });
    await buildUser({ teamId: team.id, email });

    const res = await server.post("/api/vault.transfer", {
      headers: vaultCookie(email),
      body: { teamId: team.id },
    });
    expect(res.status).toEqual(403);
  });

  it("should accept a regular tenant session for switching", async () => {
    const email = `${slug()}@tin.info`;
    const teamA = await buildTeam({ subdomain: slug() });
    const teamB = await buildTeam({ subdomain: slug() });
    const user = await buildUser({ teamId: teamA.id, email });
    await buildUser({ teamId: teamB.id, email });

    const res = await server.post("/api/vault.transfer", user, {
      body: { teamId: teamB.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.url).toContain(teamB.url);
  });

  it("should require authentication", async () => {
    const team = await buildTeam({ subdomain: slug() });
    const res = await server.post("/api/vault.transfer", {
      body: { teamId: team.id },
    });
    expect(res.status).toEqual(403);
  });
});

describe("#vault.logout", () => {
  it("should clear the vault cookie", async () => {
    const res = await server.post("/api/vault.logout");
    expect(res.status).toEqual(200);
    const headers = res.headers.get("set-cookie");
    expect(headers).toContain("vaultSession=;");
  });
});
