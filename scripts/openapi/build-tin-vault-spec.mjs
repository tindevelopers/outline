// Rebrands Outline's OpenAPI spec as the TIN Vault API. Usage:
//   node scripts/openapi/build-tin-vault-spec.mjs <upstream spec3.yml> <commit>
// Writes public/developers/openapi.yaml and openapi.upstream.json. Exits 1
// if any Outline branding or getoutline.com URL survives the rewrite.
import fs from "node:fs";
import yaml from "js-yaml";

const [input, commit] = process.argv.slice(2);
if (!input || !commit) {
  console.error("usage: build-tin-vault-spec.mjs <spec3.yml> <commit>");
  process.exit(1);
}

const BASE = "https://docs.tin.info";
const rewrite = (s) =>
  s
    .replace(/https:\/\/app\.getoutline\.com/g, BASE)
    .replace(
      /https:\/\/[a-z0-9-]+\.getoutline\.com/g,
      "https://workspace.docs.tin.info"
    )
    // Bare-domain form (no https:// prefix), e.g. an "example: acme-inc.getoutline.com" field.
    .replace(/\b[a-z0-9-]+\.getoutline\.com\b/g, "workspace.docs.tin.info")
    .replace(
      /\[openapi specification\]\(https:\/\/github\.com\/outline\/openapi\)/g,
      `[OpenAPI specification](${BASE}/developers/openapi.yaml)`
    )
    .replace(
      /https:\/\/github\.com\/outline\/openapi\/blob\/main\/LICENSE/g,
      `${BASE}/developers/LICENSES/outline-openapi-BSD-3-Clause.txt`
    )
    .replace(/\bOutline API\b/g, "TIN Vault API")
    .replace(/\bOutline(’|')s\b/g, "TIN Vault$1s")
    .replace(/\bOutline\b/g, "TIN Vault")
    // Example values and prose only. Real API values such as the
    // `outline-markdown` export format must stay as they are.
    .replace(/\boutline-api-/g, "tin-vault-api-")
    .replace(/\/webhooks\/outline\b/g, "/webhooks/tin-vault")
    .replace(/in the outline-icons package/g, "from the built-in icon set")
    .replace(/from the outline-icons package/g, "from the built-in icon set");

// Recursively rewrite every string value. Keys, and so paths and schema
// names, stay untouched.
const walk = (v) =>
  typeof v === "string"
    ? rewrite(v)
    : Array.isArray(v)
      ? v.map(walk)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
        : v;

const spec = walk(yaml.load(fs.readFileSync(input, "utf8")));

spec.info.title = "TIN Vault API";
spec.info.contact = {
  name: "TIN Vault Support",
  email: "support.docs@tin.info",
};
spec.servers = [
  { url: `${BASE}/api`, description: "TIN Vault (all workspaces)" },
];
const schemes = spec.components.securitySchemes;
schemes.BearerAuth.bearerFormat = "API key (ol_api_…) or OAuth access token";
const code = schemes.OAuth2.flows.authorizationCode;
code.authorizationUrl = `${BASE}/oauth/authorize`;
code.tokenUrl = `${BASE}/oauth/token`;
code.refreshUrl = `${BASE}/oauth/token`;

// Guard runs before the license block below is added: that block deliberately
// names "Outline" for BSD-3-Clause attribution (required by LICENSE terms),
// so it must not trip the "branding left in output" check. Every other field
// has been rewritten by here, so this still catches any real leftover.
const preLicenseBody = yaml.dump(spec, { lineWidth: -1, noRefs: true });
const leftovers = preLicenseBody.match(/getoutline\.com|\bOutline\b/g);
if (leftovers) {
  console.error(
    `branding left in output: ${[...new Set(leftovers)].join(", ")}`
  );
  process.exit(1);
}

spec.info.license = {
  name: "BSD-3-Clause (specification derived from the Outline OpenAPI spec)",
  url: `${BASE}/developers/LICENSES/outline-openapi-BSD-3-Clause.txt`,
};

const body = yaml.dump(spec, { lineWidth: -1, noRefs: true });

const notice = fs
  .readFileSync(
    "public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt",
    "utf8"
  )
  .split("\n")
  .map((l) => `# ${l}`.trimEnd())
  .join("\n");
fs.writeFileSync(
  "public/developers/openapi.yaml",
  `# TIN Vault API specification, derived from outline/openapi@${commit}.\n# Original work licensed as follows:\n${notice}\n${body}`
);
fs.writeFileSync(
  "public/developers/openapi.upstream.json",
  JSON.stringify(
    {
      repo: "https://github.com/outline/openapi",
      commit,
      fetchedAt: new Date().toISOString(),
    },
    null,
    2
  ) + "\n"
);
console.log("ok: public/developers/openapi.yaml");
