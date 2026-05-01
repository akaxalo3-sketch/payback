import { readFileSync, writeFileSync, existsSync } from "node:fs";

const STORE_PATH = "./hwids.json";

let bindings = {};
if (existsSync(STORE_PATH)) {
  bindings = JSON.parse(readFileSync(STORE_PATH));
}

function persist() {
  writeFileSync(STORE_PATH, JSON.stringify(bindings, null, 2));
}

export function validateHWID(apiKey, hwid) {
  if (!bindings[apiKey]) {
    bindings[apiKey] = { hwid, boundAt: new Date().toISOString() };
    persist();
    return true;
  }

  if (bindings[apiKey].hwid !== hwid) {
    throw new Error("HWID_MISMATCH");
  }

  return true;
}
