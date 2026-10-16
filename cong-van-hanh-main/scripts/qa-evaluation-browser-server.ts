import "dotenv/config";

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  dispatchEvaluationRpc,
  EvaluationRuntimeError,
} from "@/lib/evaluation/runtime";
import { asRecord } from "@/lib/operations/json";

const port = Number(process.env.EVALUATION_QA_PORT || 3013);
const host = "127.0.0.1";
const publicRoot = path.join(process.cwd(), "public");
const readOnly = process.env.EVALUATION_QA_READ_ONLY === "1";
const readOnlyMethods = new Set(["getEvaluationConfigData", "getEvaluationAdminWorkspaceData", "getEvaluationAssignedInstances", "getEvaluationInstanceDetail"]);

async function adminSession(): Promise<AppSession> {
  const user = await getDb().user.findFirstOrThrow({
    include: { userRoles: { include: { role: true } } },
    orderBy: { createdAt: "asc" },
    where: { status: "ACTIVE" },
  });
  return {
    displayName: user.displayName,
    fullAccess: true,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: ["super-admin"],
    userId: user.id,
  };
}

async function readBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    args?: unknown[];
    method?: string;
    payload?: unknown;
  };
}

function framePage(file: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Evaluation QA</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style></head><body><iframe src="/legacy/${file}"></iframe></body></html>`;
}

async function main() {
  const session = await adminSession();
  createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${host}:${port}`);
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<!doctype html><meta charset=utf-8><title>Services QA</title><h1>Services QA</h1>");
        return;
      }
      if (request.method === "GET" && url.pathname === "/cnb") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(framePage("evaluation-config.html"));
        return;
      }
      if (request.method === "GET" && url.pathname === "/evaluation") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(framePage("evaluation.html"));
        return;
      }
      if (request.method === "GET" && url.pathname === "/recruitment") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(framePage("recruitment-assessment.html"));
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/legacy/")) {
        const file = path.basename(url.pathname);
        const html = await readFile(path.join(publicRoot, "legacy", file));
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/html; charset=utf-8",
        });
        response.end(html);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/evaluation/rpc") {
        const body = await readBody(request);
        if (readOnly && !readOnlyMethods.has(String(body.method || ""))) {
          response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: false, message: "Phiên QA chỉ đọc: thao tác ghi hoặc gửi email đã bị khóa." }));
          return;
        }
        const payload = asRecord(
          body.payload !== undefined ? body.payload : body.args?.[0],
        );
        const result = await dispatchEvaluationRpc(
          session,
          String(body.method || ""),
          payload,
        );
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, result }));
        return;
      }
      response.writeHead(404).end("Not found");
    } catch (error) {
      const status = error instanceof EvaluationRuntimeError ? error.status : 500;
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          ok: false,
        }),
      );
    }
  }).listen(port, host, () => {
    console.log(`Evaluation QA: http://${host}:${port}/cnb`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
