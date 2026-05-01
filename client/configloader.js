import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "config.json5");

const exampleConfig = `{
  v: 3.0,

  captcha: {
    // Supported captcha providers:
    // - "nextcaptcha"
    // - "capmonster"
    service: "nextcaptcha",

    // API key for the selected captcha provider
    apiKey: "api-key-for-captcha-service"
  },

  // Payback seems to have strict IP rate limiting.
  // It is recommended to use proxies with a large IP pool
  // (preferably low-fraud IPs and European locations).
  // You can either select specific countries or use random locations.
  // Test different providers and setups to find what works best.
  //
  // It is recommended to use sticky proxies with a country that has a high IP pool.
  // This reduces the risk of exhausting the IP pool
  // and allows longer runtimes with fewer retries.
  //
  // For example: flameproxies.com with sticky proxies and Brazil country it has 2 million IPs.
  //
  // Use rotating or sticky residential proxies in the following format:
  proxy: "http://username:password@host:port",

  server: {
    // API key provided by Yourself
    apiKey: "auth-key"
  },

  // Number of tasks to run concurrently
  // Recommended: 1000
  concurrency: 1000,

  // Number of lines to skip at the beginning of the input file
  skipLines: 0,

  // Enable logging of responses for easier debugging
  debug: false
}`;

const VALID_CAPTCHA_SERVICES = ["nextcaptcha", "capmonster"];

function validate(config) {
  if (config.v !== 3.0) {
    return ["Please delete config.json5 and rerun the program."];
  }

  const errors = [];

  if (typeof config.debug !== "boolean") {
    errors.push("'debug' must be a boolean (true or false).");
  }

  if (!config.captcha || typeof config.captcha !== "object") {
    errors.push("'captcha' block is missing or not an object.");
  } else {
    if (!VALID_CAPTCHA_SERVICES.includes(config.captcha.service)) {
      errors.push(
        `'captcha.service' must be one of: ${VALID_CAPTCHA_SERVICES.join(", ")} (got "${config.captcha.service}")`,
      );
    }
    if (!config.captcha.apiKey || typeof config.captcha.apiKey !== "string") {
      errors.push("'captcha.apiKey' is required and must be a non-empty string.");
    }
  }

  if (!config.proxy || typeof config.proxy !== "string") {
    errors.push("'proxy' is required and must be a non-empty string.");
  } else if (!/^(https?|socks5):\/\/.+:.+@.+:\d+$/.test(config.proxy)) {
    errors.push("'proxy' must match format http://username:password@host:port");
  }

  if (!config.server || typeof config.server !== "object") {
    errors.push("'server' block is missing or not an object.");
  } else {
    if (!config.server.apiKey || typeof config.server.apiKey !== "string") {
      errors.push("'server.apiKey' is required and must be a non-empty string.");
    }
  }

  if (config.concurrency === undefined) {
    errors.push("'concurrency' is required.");
  } else if (
    typeof config.concurrency !== "number" ||
    !Number.isInteger(config.concurrency) ||
    config.concurrency < 1 ||
    config.concurrency > 3000
  ) {
    errors.push("'concurrency' must be an integer between 1 and 3000.");
  }

  if (
    typeof config.skipLines !== "number" ||
    !Number.isInteger(config.skipLines) ||
    config.skipLines < 0
  ) {
    errors.push("'skipLines' must be a non-negative integer.");
  }

  return errors;
}

let config;

try {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, exampleConfig);

    console.log("\n\x1b[33m[WARNING] No config found.\x1b[0m");
    console.log(`\x1b[32m[CREATED] Example config at: ${CONFIG_PATH}\x1b[0m\n`);

    console.log("\x1b[36m[INFO] Please edit config.json5 and restart.\x1b[0m\n");

    process.exit(1);
  }

  const raw = readFileSync(CONFIG_PATH);
  config = JSON5.parse(raw);

  const errors = validate(config);
  if (errors.length > 0) {
    console.error("\n\x1b[31m[FAILED] Config validation failed:\x1b[0m\n");
    errors.forEach((e) => console.error(`\x1b[31m  - ${e}\x1b[0m`));
    console.log("\n");
    process.exit(1);
  }
} catch (err) {
  console.error(`\n\x1b[31m[ERROR] Invalid config syntax:\n` + `  ${err.message}\n\n\x1b[0m`);
  process.exit(1);
}

export default config;
