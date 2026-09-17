import Router from "koa-router";
import teamCreator from "@server/commands/teamCreator";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Team, User } from "@server/models";
import { authorize } from "@server/policies";
import { presentTeam } from "@server/presenters";
import { sequelize } from "@server/storage/database";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import * as T from "./schema";

const router = new Router();

/**
 * Platform (ops) console: manage tenants across the whole deployment.
 *
 * All endpoints require the request to be authorized against the platform
 * capability by the caller (see `authorizeOperation`). Every tenant is a
 * `Team`; the ops console creates and lists them so each company gets its own
 * isolated subdomain-backed workspace.
 */
router.post(
  "ops.teams.list",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth(),
  transaction(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    authorize(user, "manageOps", user.team);

    const [teams, userCounts] = await Promise.all([
      Team.scope("withDomains").findAll({
        order: [["createdAt", "ASC"]],
      }),
      User.findAll({
        attributes: ["teamId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
        group: ["teamId"],
        raw: true,
        paranoid: false,
      }),
    ]);

    const countsByTeam = new Map(
      (
        userCounts as unknown as Array<{ teamId: string; count: string | number }>
      ).map((row) => [`${row.teamId}`, Number(row.count)])
    );

    ctx.body = {
      data: teams.map((team) => ({
        ...presentTeam(team),
        userCount: countsByTeam.get(team.id) ?? 0,
      })),
    };
  }
);

router.post(
  "ops.teams.create",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth(),
  validate(T.OpsTeamCreateSchema),
  transaction(),
  async (ctx: APIContext<T.OpsTeamCreateSchemaReq>) => {
    const { user } = ctx.state.auth;
    authorize(user, "manageOps", user.team);

    const { name, subdomain } = ctx.input.body;
    const team = await teamCreator(ctx, {
      name,
      subdomain,
      authenticationProviders: [],
    });

    ctx.body = {
      data: presentTeam(team),
    };
  }
);

export default router;
