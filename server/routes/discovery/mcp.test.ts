import { faker } from "@faker-js/faker";
import env from "@server/env";
import { Team } from "@server/models";
import { buildTeam } from "@server/test/factories";
import { mcpRequest } from "@server/test/McpHelper";
import { getTestServer, setSelfHosted } from "@server/test/support";
import { resetVaultModeCache } from "@server/utils/vault";

const server = getTestServer();

describe("OAuth and MCP discovery on a self-hosted multi-tenant install", () => {
  it("advertises the tenant origin for a request on a team subdomain", async () => {
    setSelfHosted();
    const baseHost = new URL(env.URL).host;
    const subdomain = faker.internet.domainWord();
    await buildTeam({ subdomain });
    const origin = `https://${subdomain}.${baseHost}`;

    const res = await server.get("/.well-known/oauth-authorization-server", {
      headers: { host: `${subdomain}.${baseHost}` },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.issuer).toEqual(origin);
    expect(body.authorization_endpoint).toEqual(`${origin}/oauth/authorize`);
    expect(body.token_endpoint).toEqual(`${origin}/oauth/token`);
    expect(body.registration_endpoint).toEqual(`${origin}/oauth/register`);
  });

  it("points the protected resource metadata at the tenant origin", async () => {
    setSelfHosted();
    const baseHost = new URL(env.URL).host;
    const subdomain = faker.internet.domainWord();
    await buildTeam({ subdomain });
    const origin = `https://${subdomain}.${baseHost}`;

    const res = await server.get("/.well-known/oauth-protected-resource/mcp", {
      headers: { host: `${subdomain}.${baseHost}` },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.resource).toEqual(`${origin}/mcp`);
    expect(body.authorization_servers).toEqual([origin]);
  });

  it("keeps the configured base origin for a request on the base host", async () => {
    setSelfHosted();
    const baseUrl = new URL(env.URL);
    await buildTeam({ subdomain: faker.internet.domainWord() });

    const res = await server.get("/.well-known/oauth-protected-resource", {
      headers: { host: baseUrl.host },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.resource).toEqual(`${baseUrl.origin}/mcp`);
  });

  it("points the WWW-Authenticate challenge at the tenant origin", async () => {
    setSelfHosted();
    const baseHost = new URL(env.URL).host;
    const subdomain = faker.internet.domainWord();
    await buildTeam({ subdomain });

    const { body } = mcpRequest("tools/list");
    const res = await server.post("/mcp/", {
      headers: {
        Accept: "application/json, text/event-stream",
        host: `${subdomain}.${baseHost}`,
      },
      body,
    });

    expect(res.status).toEqual(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `https://${subdomain}.${baseHost}/.well-known/oauth-protected-resource/mcp`
    );
  });
});

describe("OAuth discovery on the vault apex", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetVaultModeCache();
  });

  it("does not advertise dynamic registration", async () => {
    setSelfHosted();
    resetVaultModeCache();
    vi.spyOn(Team, "count").mockImplementation(async (options) =>
      options?.where ? 0 : 2
    );
    const { host, origin } = new URL(env.URL);

    const res = await server.get("/.well-known/oauth-authorization-server", {
      headers: { host },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.authorization_endpoint).toEqual(`${origin}/oauth/authorize`);
    expect(body.token_endpoint).toEqual(`${origin}/oauth/token`);
    expect(body.registration_endpoint).toBeUndefined();
  });
});
