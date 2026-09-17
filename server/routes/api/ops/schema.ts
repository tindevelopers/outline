import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const OpsTeamCreateSchema = BaseSchema.extend({
  body: z.object({
    /** The displayed name of the tenant/company workspace */
    name: z.string().min(1),
    /** The preferred subdomain for the tenant, slugified and deduplicated */
    subdomain: z.string().min(1),
  }),
});

export type OpsTeamCreateSchemaReq = z.infer<typeof OpsTeamCreateSchema>;
