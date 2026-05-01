process.env.TZ = "Europe/Berlin";
import cluster from "node:cluster";
import os from "node:os";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { Pool } from "undici";
import pino from "pino";
import { decrypt, encrypt } from "./crypto.js";
import "dotenv/config";
import { validateHWID } from "./hwid.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FORWARDER_URL = "http://127.0.0.1:8080";
const PORT = 3000;
const MAX_WORKERS = 10;
const WORKERS = Math.min(os.cpus().length, MAX_WORKERS);
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
const DEBUG = false;

const VALID_API_KEYS = new Set([
  "your_key",
]);

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l o",
    },
  },
});

if (cluster.isPrimary) {
  logger.info({ workers: WORKERS, cores: os.cpus().length }, "primary starting workers");

  for (let i = 0; i < WORKERS; i++) cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    logger.error({ workerPid: worker.process.pid, code, signal }, "worker exited, respawning");
    cluster.fork();
  });
} else {
  startWorker();
}

function startWorker() {
  const app = express();

  const pool = new Pool(FORWARDER_URL, {
    connections: 256,
    pipelining: 1,
    keepAliveTimeout: 300_000,
    keepAliveMaxTimeout: 900_000,
    headersTimeout: 40_000,
    bodyTimeout: 45_000,
    connect: { timeout: 5_000 },
  });

  if (DEBUG) {
    setInterval(() => {
      logger.info(
        {
          pid: process.pid,
          pool: {
            connected: pool.stats.connected,
            pending: pool.stats.pending,
            running: pool.stats.running,
            size: pool.stats.size,
          },
        },
        "Pool stats updated",
      );
    }, 5_000);
  }

  const jsonParser = express.json({ limit: "512kb", type: "application/json" });
  const rawParser = express.raw({ limit: "512kb", type: "application/json" });

  app.use((req, res, next) => {
    const start = Date.now();
    if (DEBUG) {
      res.on("finish", () => {
        const ms = Date.now() - start;
        logger.info({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ip: req.ip,
          ms,
          apiKey: req.headers["x-api-key"] || null,
          version: req.headers["version"] || null,
        });
      });
    }
    next();
  });

  app.use((req, res, next) => {
    if (req.path.startsWith("/download")) return next();

    const apiKey = req.headers["x-api-key"];
    const version = req.headers["version"];
    const hwid = req.headers["x-hwid"];

    if (!apiKey || !VALID_API_KEYS.has(apiKey)) {
      logger.error(
        {
          method: req.method,
          path: req.path,
          ip: req.ip,
          apiKey: req.headers["x-api-key"] || null,
          version: req.headers["version"] || null,
        },
        "Invalid api key",
      );
      return res.status(401).json({
        error: "Unauthorized invalid or missing API key contact @drizzysgateway",
      });
    }

    if (version !== "3.1") {
      logger.error(
        {
          method: req.method,
          path: req.path,
          ip: req.ip,
          apiKey: req.headers["x-api-key"] || null,
          version: req.headers["version"] || null,
        },
        "Invalid version",
      );
      return res.status(401).json({ error: "Wrong version contact @drizzysgateway" });
    }

    try {
      validateHWID(apiKey, hwid);
    } catch {
      logger.error(
        {
          method: req.method,
          path: req.path,
          ip: req.ip,
          apiKey: req.headers["x-api-key"] || null,
          version: req.headers["version"] || null,
        },
        "Invalid HWID",
      );
      return res.status(403).json({
        error: "HWID mismatch this key is bound to another device contact @drizzysgateway",
      });
    }

    next();
  });

  const ALLOWED_FILES = new Set(["updatedChecker.mjs"]);

  app.get("/download/:filename", async (req, res) => {
    const { filename } = req.params;
    if (!ALLOWED_FILES.has(filename)) {
      logger.error(
        {
          method: req.method,
          path: req.path,
          ip: req.ip,
          apiKey: req.headers["x-api-key"] || null,
          version: req.headers["version"] || null,
        },
        "File not found update failed",
      );
      return res.status(404).json({
        error: "File not found update failed contact @drizzysgateway",
      });
    }
    try {
      const filePath = join(__dirname, "files", filename);
      const content = await readFile(filePath);
      res.json({ payload: encrypt(content, KEY) });
    } catch (err) {
      logger.error(
        {
          err,
          method: req.method,
          path: req.path,
          ip: req.ip,
          apiKey: req.headers["x-api-key"] || null,
          version: req.headers["version"] || null,
        },
        "error in /download",
      );
      res.status(500).json({ error: "Failed to download file contact @drizzysgateway" });
    }
  });

  app.post("/request", jsonParser, async (req, res) => {
    try {
      const payload = req.body?.payload;
      if (!payload) {
        logger.error(
          {
            method: req.method,
            path: req.path,
            ip: req.ip,
            apiKey: req.headers["x-api-key"] || null,
            version: req.headers["version"] || null,
          },
          "no payload",
        );
        res.status(400).json({ error: "Missing 'payload' field" });

        return;
      }

      let decrypted;
      try {
        decrypted = decrypt(payload, KEY);
      } catch {
        logger.error(
          {
            method: req.method,
            path: req.path,
            ip: req.ip,
            apiKey: req.headers["x-api-key"] || null,
            version: req.headers["version"] || null,
          },
          "manipulated",
        );
        return res
          .status(400)
          .json({ error: "Decryption failed invalid key or corrupted payload" });
      }

      const { body } = await pool.request({
        method: "POST",
        path: "/api/forward",
        headers: { "content-type": "application/json", "x-api-key": "main" },
        body: decrypted,
      });

      const forwarderResponse = await body.text();

      res.status(200).json({ payload: encrypt(forwarderResponse, KEY) });
    } catch (err) {
      if (err.message.includes("HeadersTimeoutError")) return;
      logger.error(
        {
          err,
          method: req.method,
          path: req.path,
          ip: req.ip,
          apiKey: req.headers["x-api-key"] || null,
          version: req.headers["version"] || null,
        },
        "error in /request",
      );
      res.status(502).json({ error: "error in /request" });
    }
  });

  app.post("/free", rawParser, async (req, res) => {
    try {
      const { body } = await pool.request({
        method: "POST",
        path: "/api/free-session",
        headers: { "content-type": "application/json", "x-api-key": "main" },
        body: req.body,
      });
      await body.dump();
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error(
        {
          err,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ip: req.ip,
          apiKey: req.headers["x-api-key"] || null,
          version: req.headers["version"] || null,
        },
        "error in /free",
      );
      res.status(502).json({ error: "error in /free" });
    }
  });

  const server = app.listen(PORT, () => logger.info("listening"));
  server.requestTimeout = 60_000;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 305_000;
}
