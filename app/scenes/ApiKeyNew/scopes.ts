import i18next from "i18next";

/** How much of an area an API key may use. */
export type AccessLevel = "none" | "read" | "create" | "write";

/** One row of the permissions table. */
export interface AccessArea {
  /** The API namespace, for example `documents` for `/api/documents.*`. */
  id: string;
  /** Human readable name shown in the picker. */
  label: string;
  /** Whether the area has a create method, so "Read and create" is offered. */
  canCreate: boolean;
  /** Extra help shown under the row, for areas where Write is broad. */
  hint?: string;
}

/**
 * The areas offered in the picker. Only content areas are listed. Admin and
 * identity areas (users, groups, API keys, OAuth clients, webhooks, workspace
 * settings and so on) are deliberately absent: they can only be granted through
 * Full access or the Advanced text box. Scopes are allow-lists, so an area that
 * is not selected is not reachable.
 */
export const ACCESS_AREAS: AccessArea[] = [
  { id: "documents", label: i18next.t("Documents"), canCreate: true },
  {
    id: "collections",
    label: i18next.t("Collections"),
    canCreate: true,
    hint: i18next.t("Write includes sharing a collection with other people"),
  },
  { id: "comments", label: i18next.t("Comments"), canCreate: true },
  { id: "attachments", label: i18next.t("Attachments"), canCreate: true },
  { id: "templates", label: i18next.t("Templates"), canCreate: true },
  { id: "revisions", label: i18next.t("Revisions"), canCreate: false },
  {
    id: "shares",
    label: i18next.t("Shared links"),
    canCreate: true,
    hint: i18next.t("Write can publish documents to the public internet"),
  },
  { id: "pins", label: i18next.t("Pins"), canCreate: true },
  { id: "stars", label: i18next.t("Stars"), canCreate: true },
  { id: "subscriptions", label: i18next.t("Subscriptions"), canCreate: true },
];

/** The picker's state: either full access, or a level per area. */
export interface ScopeSelection {
  full: boolean;
  levels: Record<string, AccessLevel>;
}

/** A quick-start selection shown above the table. */
export interface ScopePreset {
  id: string;
  label: string;
  /** Builds a new selection each call so callers can mutate it safely. */
  selection: () => ScopeSelection;
}

/**
 * Creates a selection that grants nothing.
 *
 * @returns an empty selection.
 */
export function emptySelection(): ScopeSelection {
  return { full: false, levels: {} };
}

/**
 * The preset selections. Presets cover only the catalog areas, so a preset
 * never grants admin or identity access (apart from Full access).
 */
export const SCOPE_PRESETS: ScopePreset[] = [
  {
    id: "read-only",
    label: i18next.t("Read-only"),
    selection: () => ({
      full: false,
      levels: Object.fromEntries(ACCESS_AREAS.map((a) => [a.id, "read"])),
    }),
  },
  {
    id: "read-create-documents",
    label: i18next.t("Read and create documents"),
    selection: () => ({
      full: false,
      levels: Object.fromEntries(
        ACCESS_AREAS.map((a) => [
          a.id,
          a.id === "documents" ? "create" : "read",
        ])
      ),
    }),
  },
  {
    id: "full",
    label: i18next.t("Full access"),
    selection: () => ({ full: true, levels: {} }),
  },
];

/**
 * Converts a picker selection into the scope strings the API accepts.
 *
 * - Full access becomes `["*"]`.
 * - `read` becomes `<area>:read`.
 * - `create` becomes `<area>:read` and `<area>:create`. On an area that cannot
 *   create it degrades to read.
 * - `write` becomes `<area>:write`, which covers every method in that area.
 *
 * @param selection the picker state.
 * @returns the scopes, in catalog order, or an empty list if nothing is
 * selected.
 */
export function selectionToScopes(selection: ScopeSelection): string[] {
  if (selection.full) {
    return ["*"];
  }

  const scopes: string[] = [];
  for (const area of ACCESS_AREAS) {
    switch (selection.levels[area.id]) {
      case "read":
        scopes.push(`${area.id}:read`);
        break;
      case "create":
        scopes.push(`${area.id}:read`);
        if (area.canCreate) {
          scopes.push(`${area.id}:create`);
        }
        break;
      case "write":
        scopes.push(`${area.id}:write`);
        break;
      default:
        break;
    }
  }
  return scopes;
}
