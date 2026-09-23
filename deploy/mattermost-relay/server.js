// Relays Outline webhook deliveries into a Mattermost channel via an
// Incoming Webhook. Outline signs each delivery with HMAC-SHA256 over
// "<unix_ms_timestamp>.<raw_body>" using the webhook subscription's secret
// (server/models/WebhookSubscription.ts:244-256); this verifies that
// signature before relaying anything, and rejects stale timestamps to stop
// replay of a captured request.
//
// One deployment serves multiple Outline workspaces. Each workspace's
// webhook subscription has its own signing secret (Outline doesn't include
// any team identifier in the delivered payload itself), so the workspace is
// selected by URL path instead: point workspace X's webhook at
// https://relay.docs.tin.info/<slug-below>. Add a new workspace by adding an
// entry to TEAMS and its secret to .env - no Caddy change needed, the host
// route already forwards the whole path.
//
// Env vars, set in .env and passed through docker-compose.yml:
//   OUTLINE_WEBHOOK_SECRET       - TIN workspace's webhook signing secret
//   PROGRAMMING_OUTLINE_SECRET   - Programming workspace's webhook signing secret
//   MATTERMOST_WEBHOOK_URL       - shared Incoming Webhook URL (Outline
//                                  Notification channel), used by every team
const http = require("node:http");
const crypto = require("node:crypto");

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const PORT = process.env.PORT || 8787;

const { OUTLINE_WEBHOOK_SECRET, PROGRAMMING_OUTLINE_SECRET, MATTERMOST_WEBHOOK_URL } = process.env;
if (!MATTERMOST_WEBHOOK_URL) {
  console.error("MATTERMOST_WEBHOOK_URL is required");
  process.exit(1);
}

// slug (URL path segment) -> { teamUrl, secret, label }. teamUrl and label
// are not secret and live in code; only each team's signing secret comes
// from the environment.
const TEAMS = {
  tin: {
    teamUrl: "https://tin.docs.tin.info",
    secret: OUTLINE_WEBHOOK_SECRET,
    label: "TIN",
  },
  programming: {
    teamUrl: "https://programming.docs.tin.info",
    secret: PROGRAMMING_OUTLINE_SECRET,
    label: "Programming",
  },
};

for (const [slug, team] of Object.entries(TEAMS)) {
  if (!team.secret) {
    console.warn(`No secret configured for team "${slug}" - its webhook path will reject everything`);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method not allowed");
    return;
  }

  const slug = (req.url || "/").replace(/^\/+|\/+$/g, "").toLowerCase();
  const team = TEAMS[slug];
  if (!team) {
    res.writeHead(404).end("Unknown workspace");
    return;
  }

  const rawBody = await readBody(req);
  const signatureHeader = req.headers["outline-signature"];
  if (!team.secret || !isValidSignature(signatureHeader, rawBody, team.secret)) {
    res.writeHead(401).end("Invalid signature");
    return;
  }

  let delivery;
  try {
    delivery = JSON.parse(rawBody);
  } catch {
    res.writeHead(400).end("Bad JSON");
    return;
  }

  const text = formatMessage(delivery, team);
  if (!text) {
    // Event type we don't render; ack so Outline doesn't retry.
    res.writeHead(200).end("ignored");
    return;
  }

  try {
    const mmResp = await fetch(MATTERMOST_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!mmResp.ok) {
      res.writeHead(502).end(`Mattermost rejected: ${mmResp.status}`);
      return;
    }
    res.writeHead(200).end("ok");
  } catch (err) {
    console.error("Failed to reach Mattermost", err);
    res.writeHead(502).end("Upstream error");
  }
});

server.listen(PORT, () => {
  console.log(`outline-mattermost-relay listening on :${PORT}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isValidSignature(header, rawBody, secret) {
  if (!header) {
    return false;
  }
  const match = /^t=(\d+),s=([0-9a-f]+)$/.exec(header);
  if (!match) {
    return false;
  }
  const [, tRaw, sig] = match;
  const timestamp = Number(tRaw);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_SIGNATURE_AGE_MS) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const sigBuf = Buffer.from(sig, "hex");
  if (expectedBuf.length !== sigBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

function formatMessage(delivery, team) {
  const { event, payload } = delivery;
  const model = payload?.model;
  if (!model) {
    return null;
  }

  switch (event) {
    case "documents.create":
      return line(team, "📄", model.createdBy?.name, "created", model.title, model.url);
    case "documents.publish":
      return line(team, "✅", model.updatedBy?.name ?? model.createdBy?.name, "published", model.title, model.url);
    case "documents.update":
      return line(team, "✏️", model.updatedBy?.name, "updated", model.title, model.url);
    case "documents.archive":
      return line(team, "📦", model.updatedBy?.name, "archived", model.title, model.url);
    case "documents.delete":
      return line(team, "🗑️", model.updatedBy?.name ?? model.createdBy?.name, "deleted", model.title, null);
    case "comments.create":
      return `[${team.label}] 💬 **${model.createdBy?.name ?? "Someone"}** commented on a document`;
    case "collections.create":
      // Outline's collection payload doesn't include a createdBy user (unlike
      // documents/comments), so this can't name the actor.
      return line(team, "📁", null, "created collection", model.name, model.url);
    default:
      return null;
  }
}

function line(team, emoji, actor, verb, title, relativeUrl) {
  const who = actor ?? "Someone";
  const what = title ? `*${title}*` : "a document";
  const link = relativeUrl ? ` (${team.teamUrl}${relativeUrl})` : "";
  return `[${team.label}] ${emoji} **${who}** ${verb} ${what}${link}`;
}
