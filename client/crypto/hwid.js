import { createHash } from "node:crypto";
import os from "node:os";

export function getHWID() {
  const raw = [
    os.hostname(),
    os.userInfo().username,
    os.cpus()[0].model,
    os.arch(),
    os.totalmem(),
  ].join("|");

  return createHash("sha256").update(raw).digest("hex");
}
