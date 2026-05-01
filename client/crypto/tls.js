import { Pool } from "undici";
import { KEY } from "../utils/helper.js";
import { decrypt, encrypt } from "./crypto.js";
import { getHWID } from "./hwid.js";

const HWID = getHWID();

const API_BASE = "GATEWAY_SERVER";

const pool = new Pool(API_BASE, {
  connections: 1024,
  pipelining: 1,
  keepAliveTimeout: 300_000,
  keepAliveMaxTimeout: 900_000,
  headersTimeout: 50_000,
  bodyTimeout: 55_000,
  connect: { timeout: 10_000 },
});

let debugActive = null;

export async function tlsRequest({
  API_KEY,
  version,
  proxy,
  sessionId,
  url,
  method,
  headers,
  body,
  headerOrder,
  debug,
}) {
  if (!debugActive) {
    if (debug) {
      debugActive = true;

      setInterval(() => {
        console.log("\nTLS");
        console.log({
          connected: pool.stats.connected,
          pending: pool.stats.pending,
          running: pool.stats.running,
          size: pool.stats.size,
        });
        console.log("\n");
      }, 5000).unref();
    }
  }

  const payload = {
    tlsClientIdentifier: "chrome_146",
    requestUrl: url,
    requestMethod: method,
    sessionId,
    followRedirects: true,
    isRotatingProxy: true,
    timeoutSeconds: 30,
    forceHttp1: true,
    proxyUrl: proxy,
    withCustomCookieJar: true,
    withRandomTLSExtensionOrder: true,
  };
  if (headers) payload.headers = headers;
  if (headerOrder) payload.headerOrder = headerOrder;
  if (body) payload.requestBody = body;

  const encryptedPayload = encrypt(JSON.stringify(payload), KEY);

  const { statusCode, body: resBody } = await pool.request({
    method: "POST",
    path: "/request",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "x-hwid": HWID,
      version,
    },
    body: JSON.stringify({ payload: encryptedPayload }),
  });

  const data = await resBody.json();

  if (data?.error) {
    throw new Error(data.error);
  }
  const parsed = JSON.parse(decrypt(data.payload, KEY));

  return { status: statusCode, body: parsed.body, statusReq: parsed.status };
}

export async function freeSession({ sessionId, version, API_KEY }) {
  const { body } = await pool.request({
    method: "POST",
    path: "/free",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "x-hwid": HWID,
      version,
    },
    body: JSON.stringify({ sessionId }),
  });
  await body.dump();
}
