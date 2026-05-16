#!/usr/bin/env node
/**
 * Deploy Webhook — lightweight HTTP server that triggers fleet deploys.
 * Runs on 127.0.0.1:9876 (localhost only, not internet-exposed).
 * Next.js reaches it via Docker bridge: http://172.17.0.1:9876
 *
 * Protected by DEPLOY_WEBHOOK_TOKEN env var.
 * Only accepts whitelisted app names.
 */

const http = require("http");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const MAX_BODY = 1024 * 1024; // 1MB

const PORT = parseInt(process.env.DEPLOY_WEBHOOK_PORT ?? "9876", 10);
const HOST = process.env.DEPLOY_WEBHOOK_HOST ?? "127.0.0.1";
const TOKEN = process.env.DEPLOY_WEBHOOK_TOKEN;

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

server.listen(PORT, HOST, () => {
  console.log(`Deploy webhook listening on ${HOST}:${PORT}`);
});
