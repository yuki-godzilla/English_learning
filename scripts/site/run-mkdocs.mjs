import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot as root } from "../lib/project.mjs";

const localPython = process.platform === "win32"
  ? path.join(root, ".venv-site", "Scripts", "python.exe")
  : path.join(root, ".venv-site", "bin", "python");
const candidates = [
  ...(existsSync(localPython) ? [localPython] : []),
  process.platform === "win32" ? "python" : "python3",
  "python",
];

let python = null;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ["-c", "import mkdocs"], {
    cwd: root,
    stdio: "ignore",
    shell: false,
  });
  if (probe.status === 0) {
    python = candidate;
    break;
  }
}

if (!python) {
  console.error("MkDocs is unavailable. Create .venv-site and install requirements/site.txt first.");
  process.exit(1);
}

const result = spawnSync(python, ["-m", "mkdocs", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
if (result.status === 0 && process.argv[2] === "build") {
  rmSync(path.join(root, "site", "sitemap.xml"), { force: true });
  rmSync(path.join(root, "site", "sitemap.xml.gz"), { force: true });
}
process.exit(result.status ?? 1);
