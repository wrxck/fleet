#!/usr/bin/env node
/*
 * deploy webhook — lightweight http server that triggers fleet deploys.
 *
 * binds 127.0.0.1:9876 by default. NOTE: a container cannot reach a
 * loopback-bound server via the docker bridge (172.17.0.1); to let a container
 * call this you must bind a bridge-reachable address (DEPLOY_WEBHOOK_HOST), at
 * which point EVERY container on that bridge can reach it — firewall the port
 * and rely on the bearer token. the server warns at startup on a non-loopback
 * bind.
 *
 * the bearer token is read from (in order): DEPLOY_WEBHOOK_TOKEN_FILE, the
 * systemd credential $CREDENTIALS_DIRECTORY/deploy-webhook-token, then the
 * DEPLOY_WEBHOOK_TOKEN env var. prefer a file/credential so the token is not
 * baked into the unit file. only whitelisted app names are accepted.
 */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MAX_BODY = 1024 * 1024; // 1mb

const PORT = parseInt(process.env.DEPLOY_WEBHOOK_PORT ?? "9876", 10);
const HOST = process.env.DEPLOY_WEBHOOK_HOST ?? "127.0.0.1";

// read the bearer token from a file/credential when available, else the env
// var. a file keeps the secret out of the unit's Environment= (world-readable).
function readToken() {
  const credFile = process.env.CREDENTIALS_DIRECTORY
    ? path.join(process.env.CREDENTIALS_DIRECTORY, "deploy-webhook-token")
    : null;
  const file = process.env.DEPLOY_WEBHOOK_TOKEN_FILE ?? credFile;
  if (file) {
    try {
      return fs.readFileSync(file, "utf-8").trim();
    } catch (err) {
      console.error(`failed to read deploy webhook token file ${file}: ${err.message}`);
      process.exit(1);
    }
  }
  return process.env.DEPLOY_WEBHOOK_TOKEN;
}

const TOKEN = readToken();

// Comma-separated list of app names allowed to be deployed via this webhook.
// e.g. DEPLOY_WEBHOOK_APPS=myapp,myapp-staging
const ALLOWED_APPS = new Set(
  (process.env.DEPLOY_WEBHOOK_APPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

if (!TOKEN) {
  console.error("DEPLOY_WEBHOOK_TOKEN env var is required");
  process.exit(1);
}

if (ALLOWED_APPS.size === 0) {
  console.error("DEPLOY_WEBHOOK_APPS env var is required (comma-separated app names)");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // CORS / health
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/deploy") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // Auth check
  const auth = req.headers.authorization ?? "";
  const expected = `Bearer ${TOKEN}`;
  let authorized = false;
  try {
    authorized = auth.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  } catch {
    authorized = false;
  }
  if (!authorized) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Read body with size limit
  let body = "";
  let bodySize = 0;
  req.on("data", (chunk) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Payload too large" }));
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on("end", () => {
    if (res.headersSent) return;
    try {
      const { app } = JSON.parse(body);

      if (!app || !ALLOWED_APPS.has(app)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Invalid app: ${app}` }));
        return;
      }

      console.log(`[deploy] Starting deploy for ${app}...`);
      const result = spawnSync("fleet", ["deploy", app], {
        timeout: 300_000, // 5 minutes
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (result.error || result.status !== 0) {
        throw new Error(
          result.stderr || result.error?.message || `exit ${result.status}`
        );
      }
      const output = result.stdout;

      console.log(`[deploy] ${app} deployed successfully`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, output }));
    } catch (err) {
      const message = err.stderr || err.message || String(err);
      console.error(`[deploy] Failed:`, message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: message }));
    }
  });
});

const LOOPBACK = HOST === "127.0.0.1" || HOST === "::1" || HOST === "localhost";

server.listen(PORT, HOST, () => {
  console.log(`deploy webhook listening on ${HOST}:${PORT}`);
  if (!LOOPBACK) {
    console.warn(
      `[deploy] warning: bound to ${HOST} (not loopback) — every host that can ` +
        `route here, including all containers on the docker bridge, can reach ` +
        `this webhook. ensure a firewall restricts access; the bearer token is ` +
        `the only other control.`
    );
  }
});
