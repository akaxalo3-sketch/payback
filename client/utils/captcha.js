import { Pool } from "undici";
import { services } from "./constants.js";
import { delay, getTime } from "./helper.js";

const DEFAULT_MAX_ATTEMPTS = 60;

let pool = null;
let paths = null;
let activeService = null;

function initPool(service) {
  const svc = services[service];

  const createUrl = new URL(svc.createTask);

  pool = new Pool(createUrl.origin, {
    connections: 512,
    pipelining: 1,
    keepAliveTimeout: 300_000,
    keepAliveMaxTimeout: 900_000,
    headersTimeout: 15_000,
    bodyTimeout: 20_000,
    connect: { timeout: 15_000 },
  });

  paths = {
    create: createUrl.pathname,
    result: new URL(svc.getResult).pathname,
    balance: new URL(svc.getBalance).pathname,
    type: svc.type,
  };

  activeService = service;
}

function ensurePool(service) {
  if (!pool) {
    initPool(service);
    return;
  }
}

async function postJson(path, payload) {
  try {
    const res = await pool.request({
      method: "POST",
      path,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = res.body;
    const data = await body.json();
    return { statusCode: res.statusCode, data };
  } catch (err) {
    throw new Error(`[${activeService}] Error requesting ${path} ${err.message}`);
  }
}

let totalSolveTime = 0;
let solveCount = 0;
let intervalStarted = false;
let intervalStarted2 = false;

function startAvgLogger(debug, service) {
  if (!debug || intervalStarted) return;
  intervalStarted = true;
  setInterval(() => {
    if (solveCount === 0) return;
    const avg = totalSolveTime / solveCount;
    console.log(
      `\n\x1b[31m[${getTime()}] [${service}] ${(avg / 1000).toFixed(2)}s over ${solveCount} solves\x1b[0m\n`,
    );
  }, 5_000).unref();
}

export async function solveCaptcha({ service, apiKey, debug, siteKey, url }) {
  ensurePool(service);
  const startTime = Date.now();
  startAvgLogger(debug, service);

  if (debug && !intervalStarted2) {
    intervalStarted2 = true;
    setInterval(() => {
      console.log("\nCAPTCHA");
      console.log({
        connected: pool.stats.connected,
        pending: pool.stats.pending,
        running: pool.stats.running,
        size: pool.stats.size,
      });
      console.log("\n");
    }, 5_000).unref();
  }

  let createData;

  const r = await postJson(paths.create, {
    clientKey: apiKey,
    task: { type: paths.type, websiteURL: url, websiteKey: siteKey },
  });

  createData = r.data;

  if (!createData?.taskId) {
    throw new Error(`[${service}] Failed to create task ${JSON.stringify(createData)}`);
  }

  if (debug) {
    console.log(`[${getTime()}] [${service}] Created task ${createData.taskId}`);
  }

  for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt++) {
    await delay(Math.random() * 2000 + 1000);

    let result;
    const r = await postJson(paths.result, {
      clientKey: apiKey,
      taskId: createData.taskId,
    });
    result = r.data;

    if (result?.solution?.gRecaptchaResponse) {
      const duration = Date.now() - startTime;
      totalSolveTime += duration;
      solveCount++;
      if (debug) {
        console.log(
          `[${getTime()}] [${service}] Solved in ${(duration / 1000).toFixed(2)}s ${result.taskId}`,
        );
      }
      return result.solution.gRecaptchaResponse;
    }

    if (result?.status === "failed") {
      throw new Error(`[${service}] Captcha not solved ${JSON.stringify(result)}`);
    }
  }

  throw new Error(
    `[${service}] Captcha not solved after ${DEFAULT_MAX_ATTEMPTS} attempts ${createData.taskId}`,
  );
}

export async function getBalance({ service, apiKey }) {
  ensurePool(service);
  const { data } = await postJson(paths.balance, { clientKey: apiKey });
  return typeof data.balance === "number" ? data.balance.toFixed(2) : null;
}

export function getSolveStats() {
  const avgSolveTime = solveCount > 0 ? Math.round(totalSolveTime / solveCount) : 0;

  return {
    solveCount,
    avgSolveTimeSeconds: (avgSolveTime / 1000).toFixed(2),
  };
}
