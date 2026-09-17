import Router from "koa-router";
import { UserRole } from "@shared/types";
import teamCreator from "@server/commands/teamCreator";
import InviteEmail from "@server/emails/templates/InviteEmail";
import env from "@server/env";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Team, User } from "@server/models";
import { authorize } from "@server/policies";
import { presentTeam, presentUser } from "@server/presenters";
import { UserFlag } from "@server/models/User";
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
        attributes: [
          "teamId",
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
        ],
        group: ["teamId"],
        raw: true,
        paranoid: false,
      }),
    ]);

    const countsByTeam = new Map(
      (
        userCounts as unknown as Array<{
          teamId: string;
          count: string | number;
        }>
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

    const { name, subdomain, adminEmail } = ctx.input.body;
    const team = await teamCreator(ctx, {
      name,
      subdomain:
        subdomain ||
        name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, ""),
      authenticationProviders: [],
    });

    // Optionally provision the first admin user and send them an invite
    if (adminEmail) {
      const adminUser = await User.createWithCtx(
        ctx,
        {
          teamId: team.id,
          name: adminEmail.split("@")[0],
          email: adminEmail.toLowerCase(),
          role: UserRole.Admin,
          isViewer: false,
        },
        undefined
      );

      // Send invitation email so the new admin can sign in via the magic link
      await new InviteEmail({
        to: adminEmail.toLowerCase(),
        name: adminUser.name,
        actorName: user.name,
        actorEmail: user.email,
        teamName: team.name,
        teamUrl: `${env.URL.replace("://", `://${team.subdomain}.`)}`,
        language: adminUser.language,
        token: adminUser.getInviteToken(),
      }).schedule();
    }

    ctx.body = {
      data: presentTeam(team),
    };
  }
);

router.post(
  "ops.users.setPlatformAdmin",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth(),
  validate(T.OpsUserSetPlatformAdminSchema),
  transaction(),
  async (ctx: APIContext<T.OpsUserSetPlatformAdminSchemaReq>) => {
    const { user } = ctx.state.auth;
    authorize(user, "manageOps", user.team);

    const { userId, platformAdmin } = ctx.input.body;
    const target = await User.findByPk(userId, { rejectOnEmpty: true });

    // Platform Admin outranks every workspace role: granting it ensures the
    // target holds at least Admin in their own workspace.
    if (platformAdmin && target.role !== UserRole.Admin) {
      target.role = UserRole.Admin;
    }
    target.setFlag(UserFlag.PlatformAdmin, platformAdmin);
    await target.save();

    ctx.body = {
      data: presentUser(target, { includeDetails: true }),
    };
  }
);

router.post(
  "ops.teams.update",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth(),
  validate(T.OpsTeamUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.OpsTeamUpdateSchemaReq>) => {
    const { user } = ctx.state.auth;
    authorize(user, "manageOps", user.team);

    const { id, name, subdomain } = ctx.input.body;
    const team = await Team.findByPk(id, { rejectOnEmpty: true });

    if (name) {
      team.name = name;
    }
    if (subdomain) {
      team.subdomain = subdomain;
    }
    await team.save();

    ctx.body = {
      data: presentTeam(team),
    };
  }
);

router.post(
  "ops.teams.delete",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth(),
  validate(T.OpsTeamDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.OpsTeamDeleteSchemaReq>) => {
    const { user } = ctx.state.auth;
    authorize(user, "manageOps", user.team);

    const { id } = ctx.input.body;

    // Safety: never allow deleting the platform admin's own team
    if (id === user.teamId) {
      ctx.throw(
        400,
        "Cannot delete the workspace you are currently logged into"
      );
    }

    const team = await Team.findByPk(id, { rejectOnEmpty: true });
    await team.destroy();

    ctx.body = { ok: true };
  }
);

/**
 * Enter a tenant workspace as its admin (super-admin impersonation).
 *
 * Finds or provisions an account for the operator inside the target team
 * with the Admin role, then returns a single-use email sign-in URL that
 * logs the operator into that team's subdomain in a new browser tab.
 */
router.post(
  "ops.teams.impersonate",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth(),
  validate(T.OpsTeamImpersonateSchema),
  transaction(),
  async (ctx: APIContext<T.OpsTeamImpersonateSchemaReq>) => {
    const { user } = ctx.state.auth;
    authorize(user, "manageOps", user.team);

    const { id } = ctx.input.body;
    const team = await Team.findByPk(id, { rejectOnEmpty: true });

    // Find or create the operator's account inside the target team. Platform
    // admins outrank workspace roles, so the account is always an Admin.
    let target = await User.findOne({
      where: { teamId: team.id, email: user.email },
    });

    if (!target) {
      target = await User.createWithCtx(
        ctx,
        {
          teamId: team.id,
          name: user.name,
          email: user.email,
          role: UserRole.Admin,
        },
        undefined
      );
    } else if (target.role !== UserRole.Admin) {
      target.role = UserRole.Admin;
      await target.saveWithCtx(ctx);
    }

    const token = target.getEmailSigninToken(ctx);
    ctx.body = {
      data: {
        url: `${team.url}/auth/email.callback?token=${token}`,
      },
    };
  }
);

export default router;
