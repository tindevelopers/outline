import Router from "koa-router";
import { TeamPreference } from "@shared/types";
import env from "@server/env";
import { getOAuthOrigin } from "@server/utils/oauth";
import { getTeamFromContext } from "@server/utils/passport";

const router = new Router();

router.get(
  [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/mcp",
  ],
  async (ctx) => {
    const team = await getTeamFromContext(ctx, { includeOAuthState: false });
    const origin = getOAuthOrigin(ctx, team);
    const mcpEnabled = team?.getPreference(TeamPreference.MCP) ?? true;

    ctx.body = {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      ...(!env.OAUTH_DISABLE_DCR &&
        mcpEnabled && {
          registration_endpoint: `${origin}/oauth/register`,
        }),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["read", "write"],
    };
  }
);

router.get(
  [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ],
  async (ctx) => {
    const team = await getTeamFromContext(ctx, { includeOAuthState: false });
    const mcpEnabled = team?.getPreference(TeamPreference.MCP) ?? true;

    if (!mcpEnabled) {
      ctx.status = 404;
      return;
    }

    const origin = getOAuthOrigin(ctx, team);

    ctx.body = {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["read", "write"],
      bearer_methods_supported: ["header"],
    };
  }
);

// MCP clients sometimes probe the origin for a legacy HTTP+SSE endpoint. The
// application shell is not a valid response to that probe, so answer with a 404.
router.get("/sse", (ctx) => {
  ctx.status = 404;
});

export default router;
