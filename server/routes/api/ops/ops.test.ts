import { faker } from "@faker-js/faker";
import { buildAdmin, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

function buildPlatformAdmin(teamId?: string) {
  return buildAdmin({
    teamId,
    flags: { platformAdmin: 1 },
  });
}

describe("#ops.teams.list", () => {
  it("should deny non-platform admins", async () => {
    const admin = await buildAdmin();

    const res = await server.post("/api/ops.teams.list", admin, {
      body: {},
    });
    expect(res.status).toEqual(403);
  });

  it("should allow platform admins to list all tenants", async () => {
    const platformAdmin = await buildPlatformAdmin();
    await buildUser();

    const res = await server.post("/api/ops.teams.list", platformAdmin, {
      body: {},
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });
});

describe("#ops.teams.create", () => {
  it("should deny non-platform admins", async () => {
    const admin = await buildAdmin();

    const res = await server.post("/api/ops.teams.create", admin, {
      body: {
        name: "Acme Corp",
        subdomain: "acme",
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should allow platform admins to create a tenant with a subdomain", async () => {
    const platformAdmin = await buildPlatformAdmin();
    const subdomain = faker.internet.domainWord();

    const res = await server.post("/api/ops.teams.create", platformAdmin, {
      body: {
        name: "Acme Corp",
        subdomain,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.name).toEqual("Acme Corp");
    expect(body.data.subdomain).toEqual(subdomain);
  });
});
