import { randomUUID } from "node:crypto";

const ENCRYPTION_KEY = "GATEWAY_ENCRYPTION_KEY";

export const KEY = Buffer.from(ENCRYPTION_KEY, "hex");

export function getTime() {
  return new Date().toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function getResultsFolder() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `results_${month}-${day}_${hours}-${minutes}-${seconds}`;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForActiveTasks(limit) {
  if (limit.activeCount === 0) return;
  while (limit.activeCount > 0) {
    await delay(600);
  }
}

export function shuffleHeaderOrder(headers) {
  const shuffled = [...headers];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const R = "\x1b[0m";
export const G = "\x1b[32m";
export const Y = "\x1b[33m";
export const D = "\x1b[2m";
export const B = "\x1b[1m";

const val = (v) => `${B}${v}${R}`;

export const w = 52;
export const line = D + "─".repeat(w) + R;
export const blank = "";

export const row = (items) => {
  return items
    .map(([emoji, label, value]) => `  ${emoji} ${D}${label.padEnd(15)}${R} ${val(value)}`)
    .join("\n");
};

export function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function isRetryableError(message) {
  const msg = message.toLowerCase();

  if (msg.includes("403")) return true;
  if (msg.includes("error requesting")) return true;
  if (msg.includes("captchamandatory")) return true;
  if (/<[^>]+>/.test(message)) return true;
  if (msg.includes("captcha not solved")) return true;
  if (msg.includes("headers timeout error")) return true;
  if (msg.includes("es ist ein allgemeiner fehler aufgetreten")) return true;

  return false;
}

export const getValue = (value) => (value == null ? "N/A" : value);

let currentProxy = null;
let proxyUsageCount = 0;
const PROXY_ROTATE_EVERY = 500;
let blockCount = 0;
const BLOCK_ROTATE = 3;
let totalUsage = 0;
let totalRotates = 0;

export function isStickyProxy(proxyString) {
  return proxyString.includes("session");
}

export function getCurrentProxy(config) {
  if (!isStickyProxy(config.proxy)) {
    return config.proxy;
  }

  if (!currentProxy || proxyUsageCount >= PROXY_ROTATE_EVERY || blockCount >= BLOCK_ROTATE) {
    generateNewProxy(config);
  }

  totalUsage++;
  proxyUsageCount++;
  return currentProxy;
}

export function incrementBlockError() {
  blockCount++;
}

function generateNewProxy(config) {
  const sessionId = randomUUID().replace(/-/g, "").slice(0, 7);
  currentProxy = config.proxy.replace(/session-[^-@]+/, `session-${sessionId}`);
  proxyUsageCount = 0;
  blockCount = 0;
  totalRotates++;

  if (config.debug) {
    console.log(`\x1b[36m[${getTime()}] [PROXY] New session generated → ${sessionId}\x1b[0m`);
  }
  return currentProxy;
}

export function getAverageProxyUsage() {
  return totalRotates === 0 ? 0 : (totalUsage / totalRotates).toFixed(2);
}
