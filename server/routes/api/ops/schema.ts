import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const OpsTeamCreateSchema = BaseSchema.extend({
  body: z.object({
    /** The displayed name of the tenant/company workspace */
    name: z.string().min(1),
    /** The preferred subdomain for the tenant, slugified and deduplicated (defaults to slug of name) */
    subdomain: z.string().optional(),
    /** Optional email address to provision as the first admin of the new workspace */
    adminEmail: z.string().email().optional(),
  }),
});

export type OpsTeamCreateSchemaReq = z.infer<typeof OpsTeamCreateSchema>;

export const OpsTeamUpdateSchema = BaseSchema.extend({
  body: z.object({
    /** The ID of the team to update */
    id: z.string().uuid(),
    /** New display name */
    name: z.string().min(1).optional(),
    /** New subdomain */
    subdomain: z.string().min(1).optional(),
  }),
});

export type OpsTeamUpdateSchemaReq = z.infer<typeof OpsTeamUpdateSchema>;

export const OpsTeamDeleteSchema = BaseSchema.extend({
  body: z.object({
    /** The ID of the team to delete */
    id: z.string().uuid(),
  }),
});

export type OpsTeamDeleteSchemaReq = z.infer<typeof OpsTeamDeleteSchema>;

export const OpsTeamImpersonateSchema = BaseSchema.extend({
  body: z.object({
    /** The ID of the team to enter as admin */
    id: z.string().uuid(),
  }),
});

export type OpsTeamImpersonateSchemaReq = z.infer<
  typeof OpsTeamImpersonateSchema
>;

export const OpsUserSetPlatformAdminSchema = BaseSchema.extend({
  body: z.object({
    /** The ID of the user to update */
    userId: z.string().uuid(),
    /** Whether to grant or revoke platform admin */
    platformAdmin: z.boolean(),
  }),
});

export type OpsUserSetPlatformAdminSchemaReq = z.infer<
  typeof OpsUserSetPlatformAdminSchema
>;
