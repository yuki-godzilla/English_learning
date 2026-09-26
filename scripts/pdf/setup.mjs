/** Create a project-local, reproducible Python environment for Journal PDFs. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { projectRoot as root } from "../lib/project.mjs";

const environment = path.join(root, ".venv-pdf");
const localPython = process.platform === "win32"
  ? path.join(environment, "Scripts", "python.exe")
  : path.join(environment, "bin", "python");

function run(command, args, stdio = "inherit") {
  const result = spawnSync(command, args, { cwd: root, stdio, windowsHide: true, shell: false });
  if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(" ")}`);
}

if (!existsSync(localPython)) {
  const launchers = process.platform === "win32"
    ? [["py", ["-3.12"]], ["python", []]]
    : [["python3", []], ["python", []]];
  const launcher = launchers.find(([command, prefix]) => spawnSync(command, [...prefix, "-c", "import sys; assert sys.version_info >= (3, 11)"], { stdio: "ignore", shell: false }).status === 0);
  if (!launcher) throw new Error("Python 3.11 or newer is required for the PDF environment.");
  run(launcher[0], [...launcher[1], "-m", "venv", environment]);
}
run(localPython, ["-m", "pip", "install", "--disable-pip-version-check", "--requirement", path.join(root, "requirements", "pdf.txt")]);
run(localPython, ["-c", "import pypdf, reportlab"]);
console.log("Project PDF Python environment is ready: .venv-pdf");
