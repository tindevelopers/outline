import { z } from "zod";
import { ApiKey } from "@server/models";
import { BaseSchema } from "@server/routes/api/schema";
import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import { Scope } from "@shared/types";
import { ApiKeyValidation } from "@shared/validations";

const globalScopes = new Set<string>([...Object.values(Scope), "*"]);

/**
 * Normalizes a user-supplied scope into its canonical form by prefixing bare
 * route scopes with `/api/`.
 */
const normalizeScope = (scope: string) =>
  scope.startsWith("/api/") || scope.includes(":") || globalScopes.has(scope)
    ? scope
    : `/api/${scope.replace(/^\//, "")}`;

export const APIKeysCreateSchema = BaseSchema.extend({
  body: z.object({
    /** API Key name */
    name: z
      .string()
      .trim()
      .min(ApiKeyValidation.minNameLength)
      .max(ApiKeyValidation.maxNameLength),
    /** API Key expiry date */
    expiresAt: z.coerce.date().optional(),
    /**
     * The scopes this API key has access to. Required: pass `["*"]` to
     * explicitly grant full access.
     */
    scope: z
      .array(
        z
          .string()
          .trim()
          .transform(normalizeScope)
          .refine((scope) => AuthenticationHelper.isValidScope(scope), {
            error: "Scope must be a valid API scope",
          })
      )
      .min(1, { error: "Choose at least one scope, or use * for full access" }),
  }),
});

export type APIKeysCreateReq = z.infer<typeof APIKeysCreateSchema>;

export const APIKeysListSchema = BaseSchema.extend({
  body: z.object({
    /** The owner of the API key */
    userId: z.uuid().optional(),
    /** Search query to filter API keys by name */
    query: z.string().optional(),

    /** API keys sorting direction */
    direction: z
      .string()
      .optional()
      .transform((val) => (val !== "ASC" ? "DESC" : val)),

    /** API keys sorting column */
    sort: z
      .string()
      .refine((val) => Object.keys(ApiKey.getAttributes()).includes(val), {
        error: "Invalid sort parameter",
      })
      .prefault("createdAt"),
  }),
});

export type APIKeysListReq = z.infer<typeof APIKeysListSchema>;

export const APIKeysDeleteSchema = BaseSchema.extend({
  body: z.object({
    /** API Key Id */
    id: z.uuid(),
  }),
});

export type APIKeysDeleteReq = z.infer<typeof APIKeysDeleteSchema>;

export const APIKeysRegenerateSchema = BaseSchema.extend({
  body: z.object({
    /** API Key Id */
    id: z.uuid(),
    /**
     * Whether to keep the replaced secret valid for a grace period, so that
     * consumers can be updated before it stops working.
     */
    gracePeriod: z.boolean().prefault(false),
  }),
});

export type APIKeysRegenerateReq = z.infer<typeof APIKeysRegenerateSchema>;
