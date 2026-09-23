import { z } from "zod";
import { BaseSchema } from "../schema";

export const VaultsWorkspacesSchema = BaseSchema;

export type VaultsWorkspacesReq = z.infer<typeof VaultsWorkspacesSchema>;

export const VaultsTransferSchema = BaseSchema.extend({
  body: z.object({
    /** The id of the team to mint a transfer token for. */
    teamId: z.string().uuid(),
  }),
});

export type VaultsTransferReq = z.infer<typeof VaultsTransferSchema>;

export const VaultsLogoutSchema = BaseSchema;

export type VaultsLogoutReq = z.infer<typeof VaultsLogoutSchema>;
