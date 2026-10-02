# API Key Scope Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text "Scopes" box in the New API key dialog with a permissions picker (per-area None / Read / Read & create / Full, plus presets), and stop a blank scope from silently meaning full access.

**Architecture:** Scope enforcement already exists and is unchanged (`AuthenticationHelper.canAccess`, called per request in `server/middlewares/authentication.ts`). The picker is a client-side catalog that converts a selection into the existing scope strings (`documents:read`, `documents:create`, `documents:write`, or `*`). The server gains one invariant: `apiKeys.create` requires at least one scope, so full access must be asked for explicitly (`["*"]`).

**Tech Stack:** TypeScript, React + styled-components, MobX stores, zod v4 (server schema), Vitest.

**Spec:** Research and recommendations from this session (2026-10-02): GitHub fine-grained tokens, Stripe restricted keys, Slack scopes and Notion capabilities all default to nothing granted and let the user tick exactly what they need. No separate spec file.

## Global Constraints

- Do not change `shared/helpers/AuthenticationHelper.ts` or how scopes are enforced. The scope grammar and `canAccess` stay exactly as they are (upstream Outline file).
- A scope-less key must no longer be creatable. Full access is an explicit choice, stored as `["*"]`.
- Areas outside the catalog are never offered in the picker, and scopes are allow-lists, so unlisted areas get no access. The catalog offers only these ten areas: `documents`, `collections`, `comments`, `attachments`, `templates`, `revisions`, `shares`, `pins`, `stars`, `subscriptions`. Sensitive areas (`users`, `groups`, `apiKeys`, `oauthClients`, `webhookSubscriptions`, `fileOperations`, `teams`, `integrations`, `authenticationProviders`, `ops`, `vault`, and similar) are reachable only through the Advanced text box or Full access.
- Existing keys are untouched. An existing key with no scope keeps working and is labelled "Full access" in the list.
- Do not add translation strings by hand and do not commit anything under `shared/i18n/locales/`. The image build extracts strings; running `i18next` extraction locally truncates `en_US/translation.json`, so `git restore shared/i18n` if it shows as modified.
- Follow `CLAUDE.md`: TypeScript strict, no `any`, curly braces on every `if`, named exports for new files, JSDoc on exported functions, oxfmt formatting.
- Tests must never touch the production database. Server tests run with `DATABASE_URL` taken from `.env.test` (local). Global yarn is v1, so call `node_modules/.bin/vitest` directly.
- Known upstream limitation, not changed here: `AuthenticationHelper.methodToScope` lists only some read-style methods, so `documents.search_titles`, `documents.insights` and `documents.answerQuestion` need `write`, not `read`. A "Read" key cannot call them. Mention it in the PR description.
- Spec (`public/developers/openapi.yaml`) still lists `scope` as optional on `apiKeys.create`. That endpoint only accepts a logged-in browser session, so no API client is affected. Do not regenerate the spec for this.

## Test command prefixes

Server tests:

```bash
cd /Users/developer/Projects/Outline && export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC && case "$DATABASE_URL" in *127.0.0.1*|*localhost*) ;; *) echo "REFUSING: not a local DB"; exit 1;; esac && node_modules/.bin/vitest run <file>
```

App tests (no database needed):

```bash
cd /Users/developer/Projects/Outline && export NODE_ENV=test TZ=UTC && node_modules/.bin/vitest run <file>
```

Type-check: `cd /Users/developer/Projects/Outline && node_modules/.bin/tsc --noEmit -p .`

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Server: require an explicit scope | `opus` | `general-purpose` | Credential/auth path; routing rule 3 |
| 2. Scope catalog and conversion logic | `sonnet` | `general-purpose` | Pure logic with edge cases; its output decides what access a key gets, so Task 2 gets an Opus review |
| 3. Picker UI in the New API key dialog | `sonnet` | `general-purpose` | Multi-file React work with state; no new security logic |
| 4. "Full access" label in the key list and table | `sonnet` | `general-purpose` | Two small UI edits; Haiku only researches |
| Reviews: Tasks 1 and 2 | `opus` | `general-purpose` | Security-adjacent (trust rules) |
| Reviews: Tasks 3 and 4 | `sonnet` | `general-purpose` | Per matrix |
| Final review of the whole branch | `opus` | `general-purpose` | Final review of the whole change |
| 5. Merge, deploy and production check | orchestrator | — | Production, and needs a signed-in browser session; not delegated |

---

## File map

| File | Responsibility |
|---|---|
| `server/routes/api/apiKeys/schema.ts` (modify) | `scope` becomes required and non-empty on create |
| `server/routes/api/apiKeys/apiKeys.test.ts` (modify) | Existing create tests pass a scope; new tests for the invariant |
| `app/scenes/ApiKeyNew/scopes.ts` (create) | Area catalog, levels, presets, `selectionToScopes` |
| `app/scenes/ApiKeyNew/scopes.test.ts` (create) | Conversion tests, including checks against `AuthenticationHelper.canAccess` |
| `app/scenes/ApiKeyNew/components/ScopePicker.tsx` (create) | Presets row plus the per-area table |
| `app/scenes/ApiKeyNew/index.tsx` (modify) | Uses the picker, keeps the old text box behind an Advanced toggle |
| `app/scenes/Settings/components/ApiKeyListItem.tsx` (modify) | "Full access" label for unscoped keys |
| `app/scenes/Settings/components/ApiKeysTable.tsx` (modify) | "Full access" badge for unscoped keys |

---

### Task 1: Server requires an explicit scope

**Files:**
- Modify: `server/routes/api/apiKeys/schema.ts:29-40`
- Modify: `server/routes/api/apiKeys/apiKeys.test.ts:14-139`

**Interfaces:**
- Produces: `POST /api/apiKeys.create` rejects a missing or empty `scope` with HTTP 400. `["*"]` still means full access. Task 3 relies on this: the UI always sends a non-empty array.

- [ ] **Step 1: Write the failing tests**

In `server/routes/api/apiKeys/apiKeys.test.ts`, add these two tests inside `describe("#apiKeys.create", ...)`, directly after `should allow the wildcard scope`:

```ts
  it("should reject a missing scope", async () => {
    const user = await buildUser();

    const res = await server.post("/api/apiKeys.create", user, {
      body: {
        name: "My API Key",
      },
    });

    expect(res.status).toEqual(400);
  });

  it("should reject an empty scope list", async () => {
    const user = await buildUser();

    const res = await server.post("/api/apiKeys.create", user, {
      body: {
        name: "My API Key",
        scope: [],
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toContain("Choose at least one scope");
  });
```

- [ ] **Step 2: Run them and confirm they fail**

Run the server test command with `server/routes/api/apiKeys/apiKeys.test.ts`.
Expected: the two new tests FAIL (they currently return 200, since scope is optional).

- [ ] **Step 3: Make `scope` required**

In `server/routes/api/apiKeys/schema.ts`, replace the `scope` field (lines 28-40):

```ts
    /** A list of scopes that this API key has access to */
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
      .optional(),
```

with:

```ts
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
```

- [ ] **Step 4: Update the existing tests that send no scope**

Each of these now needs `scope`, otherwise it returns 400 before reaching what it tests. In `apiKeys.test.ts`:

- `should allow creating an api key with expiry`: add `scope: ["read"],` after `expiresAt: now.toISOString(),`.
- `should allow creating an api key without expiry`: add `scope: ["read"],` after `name: "My API Key",`.
- `should allow viewers to create an api key`: add `scope: ["read"],` after `name: "My API Key",`.
- `should not allow guests to create an api key`: add `scope: ["read"],` after `name: "My API Key",` (validation runs before the policy check, so without it the guest gets 400 instead of 403).

- [ ] **Step 5: Run the file and confirm it all passes**

Run the server test command with `server/routes/api/apiKeys/apiKeys.test.ts`.
Expected: all tests PASS, including the two new ones.

- [ ] **Step 6: Type-check, lint, format**

```bash
cd /Users/developer/Projects/Outline && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/oxlint server/routes/api/apiKeys && node_modules/.bin/oxfmt server/routes/api/apiKeys/schema.ts server/routes/api/apiKeys/apiKeys.test.ts
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/routes/api/apiKeys/schema.ts server/routes/api/apiKeys/apiKeys.test.ts
git commit -m "feat: require an explicit scope when creating an API key

A blank scope used to mean full access. Full access now has to be
requested explicitly as [\"*\"]. Only the web app calls this endpoint, so no
API client is affected.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scope catalog and conversion logic

**Files:**
- Create: `app/scenes/ApiKeyNew/scopes.ts`
- Create: `app/scenes/ApiKeyNew/scopes.test.ts`

**Interfaces:**
- Produces (used by Task 3):
  - `type AccessLevel = "none" | "read" | "create" | "write"`
  - `interface AccessArea { id: string; label: string; canCreate: boolean; hint?: string }`
  - `const ACCESS_AREAS: AccessArea[]`
  - `interface ScopeSelection { full: boolean; levels: Record<string, AccessLevel> }`
  - `function emptySelection(): ScopeSelection`
  - `interface ScopePreset { id: string; label: string; selection: () => ScopeSelection }`
  - `const SCOPE_PRESETS: ScopePreset[]`
  - `function selectionToScopes(selection: ScopeSelection): string[]`

Level meaning: `read` → `<area>:read`. `create` → `<area>:read` and `<area>:create` (read plus create new items). `write` → `<area>:write`, which the existing grammar treats as everything in that area, including updates and deletes.

- [ ] **Step 1: Write the failing tests**

Create `app/scenes/ApiKeyNew/scopes.test.ts`:

```ts
import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import {
  ACCESS_AREAS,
  SCOPE_PRESETS,
  emptySelection,
  selectionToScopes,
} from "./scopes";

describe("selectionToScopes", () => {
  it("returns nothing for an empty selection", () => {
    expect(selectionToScopes(emptySelection())).toEqual([]);
  });

  it("returns the wildcard for full access", () => {
    expect(selectionToScopes({ full: true, levels: {} })).toEqual(["*"]);
  });

  it("ignores the area levels when full access is on", () => {
    const selection = emptySelection();
    selection.full = true;
    selection.levels.documents = "read";
    expect(selectionToScopes(selection)).toEqual(["*"]);
  });

  it("maps read, create and write levels to scopes in catalog order", () => {
    const selection = emptySelection();
    selection.levels.collections = "write";
    selection.levels.documents = "create";
    selection.levels.comments = "read";

    expect(selectionToScopes(selection)).toEqual([
      "documents:read",
      "documents:create",
      "collections:write",
      "comments:read",
    ]);
  });

  it("only ever produces well-formed scopes", () => {
    const selection = emptySelection();
    for (const area of ACCESS_AREAS) {
      selection.levels[area.id] = area.canCreate ? "create" : "read";
    }
    for (const scope of selectionToScopes(selection)) {
      expect(AuthenticationHelper.isValidScope(scope)).toBe(true);
    }
  });

  it("never offers create on an area that cannot create", () => {
    const selection = emptySelection();
    selection.levels.revisions = "create";
    // revisions has no create method, so a create level degrades to read
    expect(selectionToScopes(selection)).toEqual(["revisions:read"]);
  });
});

describe("scopes grant exactly what the picker promises", () => {
  it("read lets a key list and fetch but not create or delete", () => {
    const scopes = selectionToScopes({
      full: false,
      levels: { documents: "read" },
    });
    expect(AuthenticationHelper.canAccess("/api/documents.list", scopes)).toBe(
      true
    );
    expect(AuthenticationHelper.canAccess("/api/documents.info", scopes)).toBe(
      true
    );
    expect(
      AuthenticationHelper.canAccess("/api/documents.create", scopes)
    ).toBe(false);
    expect(
      AuthenticationHelper.canAccess("/api/documents.delete", scopes)
    ).toBe(false);
  });

  it("create lets a key read and create but not update or delete", () => {
    const scopes = selectionToScopes({
      full: false,
      levels: { documents: "create" },
    });
    expect(AuthenticationHelper.canAccess("/api/documents.info", scopes)).toBe(
      true
    );
    expect(
      AuthenticationHelper.canAccess("/api/documents.create", scopes)
    ).toBe(true);
    expect(
      AuthenticationHelper.canAccess("/api/documents.update", scopes)
    ).toBe(false);
    expect(
      AuthenticationHelper.canAccess("/api/documents.delete", scopes)
    ).toBe(false);
  });

  it("write covers the whole area but nothing outside it", () => {
    const scopes = selectionToScopes({
      full: false,
      levels: { documents: "write" },
    });
    expect(
      AuthenticationHelper.canAccess("/api/documents.delete", scopes)
    ).toBe(true);
    expect(AuthenticationHelper.canAccess("/api/users.delete", scopes)).toBe(
      false
    );
    expect(AuthenticationHelper.canAccess("/api/users.list", scopes)).toBe(
      false
    );
  });

  it("an area that was not selected stays out of reach", () => {
    const scopes = selectionToScopes({
      full: false,
      levels: { documents: "write" },
    });
    expect(AuthenticationHelper.canAccess("/api/collections.list", scopes)).toBe(
      false
    );
    expect(AuthenticationHelper.canAccess("/api/apiKeys.list", scopes)).toBe(
      false
    );
  });
});

describe("catalog", () => {
  it("offers only the ten content areas", () => {
    expect(ACCESS_AREAS.map((a) => a.id)).toEqual([
      "documents",
      "collections",
      "comments",
      "attachments",
      "templates",
      "revisions",
      "shares",
      "pins",
      "stars",
      "subscriptions",
    ]);
  });

  it("never offers an admin or identity area", () => {
    const ids = new Set(ACCESS_AREAS.map((a) => a.id));
    for (const sensitive of [
      "users",
      "groups",
      "apiKeys",
      "oauthClients",
      "webhookSubscriptions",
      "fileOperations",
      "teams",
      "integrations",
      "authenticationProviders",
    ]) {
      expect(ids.has(sensitive)).toBe(false);
    }
  });
});

describe("presets", () => {
  const byId = (id: string) => {
    const preset = SCOPE_PRESETS.find((p) => p.id === id);
    if (!preset) {
      throw new Error(`missing preset ${id}`);
    }
    return preset;
  };

  it("read-only reads every catalog area and grants no create or write", () => {
    const scopes = selectionToScopes(byId("read-only").selection());
    expect(scopes).toEqual(ACCESS_AREAS.map((a) => `${a.id}:read`));
  });

  it("read and create documents adds create on documents only", () => {
    const scopes = selectionToScopes(byId("read-create-documents").selection());
    expect(scopes).toContain("documents:create");
    expect(scopes.filter((s) => s.endsWith(":create"))).toEqual([
      "documents:create",
    ]);
    expect(scopes.filter((s) => s.endsWith(":write"))).toEqual([]);
  });

  it("full access is the wildcard", () => {
    expect(selectionToScopes(byId("full").selection())).toEqual(["*"]);
  });

  it("each preset returns a fresh object", () => {
    const preset = byId("read-only");
    expect(preset.selection()).not.toBe(preset.selection());
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run the app test command with `app/scenes/ApiKeyNew/scopes.test.ts`.
Expected: FAIL with "Cannot find module './scopes'" (or similar).

- [ ] **Step 3: Implement `scopes.ts`**

Create `app/scenes/ApiKeyNew/scopes.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run the app test command with `app/scenes/ApiKeyNew/scopes.test.ts`.
Expected: all tests PASS.

- [ ] **Step 5: Type-check, lint, format**

```bash
cd /Users/developer/Projects/Outline && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/oxlint app/scenes/ApiKeyNew && node_modules/.bin/oxfmt app/scenes/ApiKeyNew/scopes.ts app/scenes/ApiKeyNew/scopes.test.ts
```

Expected: no errors. Then `git status --short`: only the two new files should show. If `shared/i18n/` shows as modified, run `git restore shared/i18n`.

- [ ] **Step 6: Commit**

```bash
git add app/scenes/ApiKeyNew/scopes.ts app/scenes/ApiKeyNew/scopes.test.ts
git commit -m "feat: add the API key scope catalog and selection-to-scope conversion

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Picker UI in the New API key dialog

**Files:**
- Create: `app/scenes/ApiKeyNew/components/ScopePicker.tsx`
- Modify: `app/scenes/ApiKeyNew/index.tsx`

**Interfaces:**
- Consumes (from Task 2): `ACCESS_AREAS`, `SCOPE_PRESETS`, `selectionToScopes`, `emptySelection`, `ScopeSelection`, `AccessLevel`.
- Consumes (from Task 1): the server rejects an empty `scope`, so the form must never submit one.
- Produces: the dialog sends `scope` as a non-empty `string[]`.

Behaviour: the dialog opens with nothing selected and Create disabled. Choosing a preset or any row enables it. Choosing Full access greys out the rows. "Advanced" swaps the table for the old text box (parsed as before: split on spaces and commas). Create stays disabled while there are no scopes.

- [ ] **Step 1: Create the picker component**

Create `app/scenes/ApiKeyNew/components/ScopePicker.tsx`:

```tsx
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Text from "~/components/Text";
import {
  ACCESS_AREAS,
  SCOPE_PRESETS,
  type AccessLevel,
  type ScopeSelection,
} from "../scopes";

type Props = {
  value: ScopeSelection;
  onChange: (value: ScopeSelection) => void;
};

/**
 * Presets plus a table of areas, each with a None, Read, Read and create, or
 * Full choice. Selecting Full access disables the table.
 *
 * @param props.value the current selection.
 * @param props.onChange called with the new selection on every change.
 * @returns the picker.
 */
export function ScopePicker({ value, onChange }: Props) {
  const { t } = useTranslation();

  const levelOptions = React.useCallback(
    (canCreate: boolean): Option[] => {
      const options: Option[] = [
        { type: "item", label: t("None"), value: "none" },
        { type: "item", label: t("Read"), value: "read" },
      ];
      if (canCreate) {
        options.push({
          type: "item",
          label: t("Read and create"),
          value: "create",
        });
      }
      options.push({ type: "item", label: t("Full"), value: "write" });
      return options;
    },
    [t]
  );

  const handleLevelChange = React.useCallback(
    (areaId: string, level: string) => {
      onChange({
        full: false,
        levels: { ...value.levels, [areaId]: level as AccessLevel },
      });
    },
    [onChange, value.levels]
  );

  return (
    <Flex column gap={8}>
      <Flex gap={8} wrap>
        {SCOPE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            neutral
            onClick={() => onChange(preset.selection())}
          >
            {preset.label}
          </Button>
        ))}
      </Flex>
      {value.full && (
        <Text type="secondary" size="small" as="p">
          {t(
            "This key can do everything you can do, including managing users and settings."
          )}
        </Text>
      )}
      <Rows $disabled={value.full} aria-disabled={value.full}>
        {ACCESS_AREAS.map((area) => (
          <Row key={area.id}>
            <Flex column>
              <Text>{area.label}</Text>
              {area.hint && !value.full && (
                <Text type="tertiary" size="xsmall">
                  {area.hint}
                </Text>
              )}
            </Flex>
            <StyledSelect
              label={area.label}
              labelHidden
              short
              disabled={value.full}
              options={levelOptions(area.canCreate)}
              value={value.full ? "none" : value.levels[area.id] ?? "none"}
              onChange={(level) => handleLevelChange(area.id, level)}
            />
          </Row>
        ))}
      </Rows>
    </Flex>
  );
}

const Rows = styled.div<{ $disabled: boolean }>`
  max-height: 240px;
  overflow-y: auto;
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  border-top: 1px solid ${s("divider")};
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid ${s("divider")};
`;

const StyledSelect = styled(InputSelect)`
  width: 160px !important;
  margin-bottom: 0;
`;
```

- [ ] **Step 2: Wire it into the dialog**

In `app/scenes/ApiKeyNew/index.tsx`:

(a) Add imports. After the existing `import ExpiryDatePicker from "./components/ExpiryDatePicker";` line add:

```tsx
import { ScopePicker } from "./components/ScopePicker";
import { emptySelection, selectionToScopes } from "./scopes";
```

(b) Replace the line `const [scope, setScope] = React.useState("");` with:

```tsx
  const [selection, setSelection] = React.useState(emptySelection);
  const [advanced, setAdvanced] = React.useState(false);
  const [rawScope, setRawScope] = React.useState("");
```

(c) Replace the `submitDisabled` block:

```tsx
  const submitDisabled =
    isSaving || !name || (!expiresAt && expiryType !== ExpiryType.NoExpiration);
```

with:

```tsx
  const scopes = React.useMemo(
    () =>
      advanced
        ? rawScope.split(/[\s,]+/).filter(Boolean)
        : selectionToScopes(selection),
    [advanced, rawScope, selection]
  );

  const submitDisabled =
    isSaving ||
    !name ||
    scopes.length === 0 ||
    (!expiresAt && expiryType !== ExpiryType.NoExpiration);
```

(d) Replace `handleScopeChange`:

```tsx
  const handleScopeChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setScope(event.target.value);
    },
    []
  );
```

with:

```tsx
  const handleRawScopeChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRawScope(event.target.value);
    },
    []
  );

  const handleToggleAdvanced = React.useCallback(() => {
    setAdvanced((value) => !value);
  }, []);
```

(e) In `handleSubmit`, replace `scope: scope ? scope.split(/[\s,]+/).filter(Boolean) : undefined,` with `scope: scopes,` and replace `[t, name, scope, expiresAt, onSubmit, apiKeys]` with `[t, name, scopes, expiresAt, onSubmit, apiKeys]`.

(f) In the JSX, replace the whole block from `<Input type="text" label={t("Scopes")} ... />` through its closing `</Text>` (the old text input and the "Space-separated scopes..." helper text) with:

```tsx
        <Text type="secondary" size="small" as="p">
          {t("Choose what this key is allowed to do.")}
        </Text>
        {advanced ? (
          <>
            <Input
              type="text"
              label={t("Scopes")}
              placeholder="documents:read /api/collections.list"
              onChange={handleRawScopeChange}
              value={rawScope}
              flex
            />
            <Text type="secondary" size="small" as="p">
              {t(
                "Space-separated scopes. Use * for full access. At least one scope is required"
              )}
              .
            </Text>
          </>
        ) : (
          <ScopePicker value={selection} onChange={setSelection} />
        )}
        <Flex>
          <Button type="button" neutral onClick={handleToggleAdvanced}>
            {advanced ? t("Use the picker") : t("Advanced")}
          </Button>
        </Flex>
```

- [ ] **Step 3: Type-check, lint, format**

```bash
cd /Users/developer/Projects/Outline && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/oxlint app/scenes/ApiKeyNew && node_modules/.bin/oxfmt app/scenes/ApiKeyNew/index.tsx app/scenes/ApiKeyNew/components/ScopePicker.tsx
```

Expected: no errors. The props used here were checked against the real components (`Button` takes `neutral` but has no `small`; `Flex` takes `column`, `gap` and `wrap`; `Text` takes `size="xsmall"`). If `tsc` still reports a prop that does not exist, open the component, use its real prop name, and say so in the report. Do not cast.

- [ ] **Step 4: Run the app tests**

Run the app test command with `app/scenes/ApiKeyNew`.
Expected: Task 2's tests still PASS.

- [ ] **Step 5: Confirm the client production build still compiles**

```bash
cd /Users/developer/Projects/Outline && VITE_CJS_IGNORE_WARNING=true node_modules/.bin/vite build 2>&1 | tail -5
git status --short
```

Expected: the build finishes. `git status` shows only the two files from this task (restore `shared/i18n` if it appears, and `build/` is git-ignored).

- [ ] **Step 6: Commit**

```bash
git add app/scenes/ApiKeyNew/components/ScopePicker.tsx app/scenes/ApiKeyNew/index.tsx
git commit -m "feat: replace the free-text API key scopes box with a permissions picker

The text box stays behind an Advanced toggle. The dialog now opens with
nothing selected and Create stays disabled until a scope is chosen.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: "Full access" label for unscoped keys

**Files:**
- Modify: `app/scenes/Settings/components/ApiKeyListItem.tsx:65-76`
- Modify: `app/scenes/Settings/components/ApiKeysTable.tsx:73-84`

**Interfaces:**
- Consumes: `apiKey.scope` is `undefined`/`null` for an existing full-access key. The string "Full access" already exists in the translation catalog.

- [ ] **Step 1: List item**

In `ApiKeyListItem.tsx`, replace the `{apiKey.scope && ( <Tooltip ...>...</Tooltip> )}` block (lines 65-76) with:

```tsx
      {apiKey.scope ? (
        <Tooltip
          content={apiKey.scope.map((s) => (
            <span key={s}>
              {s}
              <br />
            </span>
          ))}
        >
          <Text type="tertiary"> &middot; {t("Restricted scope")}</Text>
        </Tooltip>
      ) : (
        <Text type="tertiary"> &middot; {t("Full access")}</Text>
      )}
```

- [ ] **Step 2: Table**

In `ApiKeysTable.tsx`, replace the `{apiKey.scope && ( <Tooltip ...>...</Tooltip> )}` block (lines 73-84) with:

```tsx
            {apiKey.scope ? (
              <Tooltip
                content={apiKey.scope.map((s) => (
                  <span key={s}>
                    {s}
                    <br />
                  </span>
                ))}
              >
                <Badge>{t("Restricted scope")}</Badge>
              </Tooltip>
            ) : (
              <Badge>{t("Full access")}</Badge>
            )}
```

- [ ] **Step 3: Type-check, lint, format**

```bash
cd /Users/developer/Projects/Outline && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/oxlint app/scenes/Settings/components && node_modules/.bin/oxfmt app/scenes/Settings/components/ApiKeyListItem.tsx app/scenes/Settings/components/ApiKeysTable.tsx
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/scenes/Settings/components/ApiKeyListItem.tsx app/scenes/Settings/components/ApiKeysTable.tsx
git commit -m "feat: label API keys without a scope as Full access

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Merge, deploy and check production (orchestrator)

Not delegated. Needs production access and a signed-in browser.

- [ ] **Step 1: Whole-branch verification**

```bash
cd /Users/developer/Projects/Outline && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/oxlint app/scenes server/routes/api/apiKeys
```

Then the server test command for `server/routes/api/apiKeys/apiKeys.test.ts`, and the app test command for `app/scenes/ApiKeyNew`. Expected: all pass.

- [ ] **Step 2: Final review** by an Opus subagent over `git diff origin/main...HEAD` (see the routing table).

- [ ] **Step 3: Open the PR** to `main` with `gh pr create --repo tindevelopers/outline`. The description must cover: what changed; that existing keys are untouched; that `apiKeys.create` now requires a scope; the upstream limitation about read-style methods that need `write`; that the spec still says scope is optional and why that is harmless. Wait for CI. Merge with a regular merge commit (`gh pr merge --merge`), the repo's convention.

- [ ] **Step 4: Wait for the image build and Watchtower** (about 20 minutes), then confirm `docker image inspect` on the server reports the merge commit.

- [ ] **Step 5: Production check in the browser** (signed in as a workspace admin): Settings → API & Access → New. Confirm:
  - The dialog opens with nothing selected and Create disabled.
  - Presets fill the table; Full access greys it out.
  - A key created with "Documents → Read" appears as "Restricted scope" and its tooltip lists `documents:read`.
  - Using that key (the user pastes it into a request; the orchestrator never handles it): `documents.list` succeeds, `documents.create` returns 403.
  - A pre-existing key shows "Full access".
  - Delete any test key afterwards.

## Not in this plan

- Readable scope names in the list tooltip (it still shows raw strings such as `documents:read`).
- Per-endpoint checkboxes (GitHub-style). The Advanced box still accepts `/api/documents.list`.
- A "no access" default for OAuth applications, MCP tokens, or webhooks.
- Changing the upstream rule that some read-style methods need `write`.
- Server-side blocking of sensitive areas. They are reachable only through Full access or Advanced; blocking them would make Advanced and Full access inconsistent.
