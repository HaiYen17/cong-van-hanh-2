import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export async function GET() {
  const bytes = await readFile(path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.mjs"));
  return new Response(bytes, { headers: {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  } });
}
