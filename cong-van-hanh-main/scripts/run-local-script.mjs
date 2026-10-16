import { spawnSync } from "node:child_process";

const task = process.argv[2];
const forwardedArgs = process.argv.slice(3);

if (task !== "setup" && task !== "dev") {
  console.error("Usage: node scripts/run-local-script.mjs <setup|dev> [...args]");
  process.exit(2);
}

const isWindows = process.platform === "win32";
let command;
let args;

if (isWindows) {
  command = "powershell";
  const script = task === "setup" ? "scripts/setup-local.ps1" : "start-dev.ps1";
  const translatedArgs = forwardedArgs.map((argument) => {
    if (argument === "--skip-install") return "-SkipInstall";
    if (argument === "--skip-checks") return "-SkipChecks";
    return argument;
  });
  args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...translatedArgs];
} else {
  command = "bash";
  const script = task === "setup" ? "scripts/setup-local.sh" : "start-dev.sh";
  args = [script, ...forwardedArgs];
}

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
