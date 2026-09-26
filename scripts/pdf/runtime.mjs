import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectRoot as root } from "../lib/project.mjs";

function canRun(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "ignore", windowsHide: true, shell: false });
  return result.status === 0;
}

function requiredOverride(name, args) {
  const command = process.env[name];
  if (!command) return null;
  if (!canRun(command, args)) throw new Error(`${name} is set but cannot run: ${command}`);
  return command;
}

export function findPdfPython() {
  const requirements = readFileSync(path.join(root, "requirements", "pdf.txt"), "utf8")
    .split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => line.trim().split("=="));
  const versionCheck = `from importlib.metadata import version\nrequirements = ${JSON.stringify(requirements)}\nassert all(version(name) == expected for name, expected in requirements)`;
  const probe = ["-c", versionCheck];
  const override = requiredOverride("JOURNAL_PDF_PYTHON", probe);
  if (override) return override;

  const localPython = process.platform === "win32"
    ? path.join(root, ".venv-pdf", "Scripts", "python.exe")
    : path.join(root, ".venv-pdf", "bin", "python");
  const bundledPython = path.join(
    os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime",
    "dependencies", "python", process.platform === "win32" ? "python.exe" : "bin/python",
  );
  const candidates = [localPython, bundledPython, process.platform === "win32" ? "python" : "python3", "python"];
  for (const candidate of [...new Set(candidates)]) {
    if ((path.isAbsolute(candidate) && !existsSync(candidate)) || !canRun(candidate, probe)) continue;
    return candidate;
  }
  throw new Error("PDF Python dependencies are unavailable. Install requirements/pdf.txt into .venv-pdf or set JOURNAL_PDF_PYTHON.");
}

export function findPdfBrowser() {
  const probe = ["--version"];
  const override = requiredOverride("JOURNAL_PDF_BROWSER", probe);
  if (override) return override;

  const programRoots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:/Program Files", "C:/Program Files (x86)"].filter(Boolean);
  const candidates = [
    ...programRoots.flatMap((directory) => [
      path.join(directory, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(directory, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]),
    ...(process.env.LOCALAPPDATA ? [
      path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    ] : []),
    "chrome", "msedge", "chromium", "chromium-browser", "google-chrome", "microsoft-edge",
  ];
  for (const candidate of [...new Set(candidates)]) {
    if ((path.isAbsolute(candidate) && !existsSync(candidate)) || !canRun(candidate, probe)) continue;
    return candidate;
  }
  throw new Error("Chrome, Edge, or Chromium is required to create the Journal PDF. Install one or set JOURNAL_PDF_BROWSER.");
}
