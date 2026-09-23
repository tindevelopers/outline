// Watches this compose project's containers and the public site URLs, and
// posts to the Outline-critical-alerts Mattermost channel on state changes
// only - a container that's been down for an hour doesn't re-alert every
// poll, and coming back up gets its own "recovered" message so a silent
// channel means "still broken", not "we stopped checking".
//
// Talks to the Docker Engine API over the mounted socket directly (raw HTTP
// over a unix socket) rather than pulling in a client library - the API
// surface used here is one GET endpoint.
//
// Env vars:
//   CRITICAL_ALERTS_WEBHOOK_URL  - Mattermost Incoming Webhook URL
//   CONTAINER_NAME_PREFIX        - only watch containers whose name starts
//                                  with this (default: "outline-"), so this
//                                  container and unrelated ones on the host
//                                  don't get alerted on by mistake
const http = require("node:http");
const https = require("node:https");

const POLL_INTERVAL_MS = 60 * 1000;
const DOCKER_SOCKET = "/var/run/docker.sock";
const NAME_PREFIX = process.env.CONTAINER_NAME_PREFIX || "outline-";
const WEBHOOK_URL = process.env.CRITICAL_ALERTS_WEBHOOK_URL;

const SITES = [
  "https://docs.tin.info",
  "https://programming.docs.tin.info",
  "https://mattermost.tin.info",
];

if (!WEBHOOK_URL) {
  console.error("CRITICAL_ALERTS_WEBHOOK_URL is required");
  process.exit(1);
}

// key -> last known state ("ok" | "bad"), so alerts only fire on transitions.
const lastState = new Map();

async function checkContainers() {
  const raw = await dockerGet("/containers/json?all=true");
  const containers = JSON.parse(raw);

  for (const c of containers) {
    const name = (c.Names?.[0] || "").replace(/^\//, "");
    if (!name.startsWith(NAME_PREFIX)) {
      continue;
    }

    const health = c.Status?.match(/\((\w+)\)/)?.[1]; // e.g. "(healthy)" / "(unhealthy)"
    const isOk = c.State === "running" && health !== "unhealthy";
    const status = c.State !== "running" ? `state=${c.State}` : health ? `health=${health}` : "running";

    await reportState(`container:${name}`, isOk, `Container **${name}** ${status}`);
  }
}

async function checkSites() {
  for (const url of SITES) {
    let ok = false;
    let detail = "";
    try {
      const status = await httpStatus(url);
      ok = status >= 200 && status < 400;
      detail = `HTTP ${status}`;
    } catch (e) {
      detail = e.message;
    }
    await reportState(`site:${url}`, ok, `${url} - ${detail}`);
  }
}

async function reportState(key, isOk, detail) {
  const prev = lastState.get(key);
  const now = isOk ? "ok" : "bad";
  lastState.set(key, now);

  if (prev === now) {
    return; // no change, no alert
  }
  if (prev === undefined && now === "ok") {
    return; // first poll and it's healthy - nothing to report
  }

  const text = now === "ok" ? `✅ Recovered: ${detail}` : `🔴 ${detail}`;
  await postToMattermost(text);
}

function dockerGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: DOCKER_SOCKET, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.end();
  });
}

function httpStatus(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", timeout: 10000 }, (res) => {
      res.resume(); // drain, don't care about the body
      resolve(res.statusCode);
    });
    req.on("timeout", () => {
      req.destroy(new Error("timed out"));
    });
    req.on("error", (e) => reject(new Error(e.message)));
    req.end();
  });
}

async function postToMattermost(text) {
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.error("Failed to post alert to Mattermost", e.message);
  }
}

async function tick() {
  try {
    await checkContainers();
  } catch (e) {
    console.error("Container check failed", e.message);
  }
  try {
    await checkSites();
  } catch (e) {
    console.error("Site check failed", e.message);
  }
}

console.log(`healthwatch starting, polling every ${POLL_INTERVAL_MS / 1000}s`);
tick();
setInterval(tick, POLL_INTERVAL_MS);
