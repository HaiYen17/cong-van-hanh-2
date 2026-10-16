import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd(), "public", "legacy");
const files = fs
  .readdirSync(root)
  .filter((file) => file.endsWith(".html"))
  .sort();

let parsed = 0;
for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    try {
      new Function(match[1]);
      parsed += 1;
    } catch (error) {
      throw new Error(`${file} script ${index}: ${error.message}`);
    }
  });
}

console.log(`Đã parse ${parsed} script block trong ${files.length} trang legacy.`);
