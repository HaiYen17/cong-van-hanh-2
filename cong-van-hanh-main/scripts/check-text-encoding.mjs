import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const roots = ["docs", "prisma", "scripts", "src"];
const extensions = new Set([
  ".css",
  ".json",
  ".md",
  ".mjs",
  ".prisma",
  ".sql",
  ".ts",
  ".tsx",
]);
const ignored = new Set([".next", "generated", "node_modules"]);
const suspicious = [
  "\uFFFD",
  "\u00C3",
  "\u00E1\u00BA",
  "\u00E1\u00BB",
  "\u00E2\u20AC",
  "\u00E2\u2020",
  "\u00C4\u2018",
  "\u00C4\u0192",
  "\u00C4\u0090",
  "\u00C2\u00B7",
  "\u00F0\u0178",
];
const decoder = new TextDecoder("utf-8", { fatal: true });
const problems = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = join(directory, entry.name);

    if (entry.isDirectory()) {
      await scan(absolute);
      continue;
    }

    if (!extensions.has(extname(entry.name))) continue;

    const path = relative(root, absolute);
    let text;
    try {
      text = decoder.decode(await readFile(absolute));
    } catch {
      problems.push(`${path}: không phải UTF-8 hợp lệ`);
      continue;
    }

    const hit = suspicious.find((token) => text.includes(token));
    if (hit) {
      problems.push(`${path}: có chuỗi nghi lỗi mã hóa "${hit}"`);
    }
  }
}

for (const directory of roots) {
  await scan(join(root, directory));
}

if (problems.length) {
  console.error("Phát hiện lỗi UTF-8/mojibake:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("UTF-8 check passed.");
}
