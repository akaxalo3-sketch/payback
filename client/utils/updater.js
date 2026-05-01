import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decrypt } from "../crypto/crypto.js";
import { KEY } from "./helper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_BASE = "GATEWAY_SERVER";

export async function updateFile({ filename }) {
  const dest = join(__dirname, filename);

  const res = await fetch(`${API_BASE}/download/${filename}`);

  const data = await res.json();

  if (data?.error) {
    throw new Error(data.error);
  }

  const decrypted = decrypt(data.payload, KEY);

  await writeFile(dest, decrypted);
}
