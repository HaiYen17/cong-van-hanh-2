import "dotenv/config";

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AppSession } from "../src/lib/auth/session";
import { getDb } from "../src/lib/db";
import {
  dispatchInboxRpc,
  InboxRuntimeError,
} from "../src/lib/requests/inbox-runtime";

const port = Number(process.env.INBOX_QA_PORT || 3012);
const host = "127.0.0.1";
const publicRoot = path.join(process.cwd(), "public");

async function adminSession(): Promise<AppSession> {
  const user = await getDb().user.findFirstOrThrow({
    include: {
      userRoles: {
        include: { role: true },
      },
    },
    where: {
      status: "ACTIVE",
      userRoles: {
        some: { role: { key: "super-admin", status: "ACTIVE" } },
      },
    },
  });
  return {
    displayName: user.displayName,
    fullAccess: true,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: user.userRoles.map(({ role }) => role.key),
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

async function main() {
  const session = await adminSession();
  createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/legacy/inbox-admin.html") {
      const html = await readFile(
        path.join(publicRoot, "legacy", "inbox-admin.html"),
      );
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(html);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/inbox/rpc") {
      const body = await readBody(request);
      const args = Array.isArray(body.args)
        ? body.args
        : body.payload !== undefined
          ? [body.payload]
          : [];
      const result = await dispatchInboxRpc(
        session,
        String(body.method || ""),
        args,
      );
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, result }));
      return;
    }
    response.writeHead(404).end("Not found");
  } catch (error) {
    const status = error instanceof InboxRuntimeError ? error.status : 500;
    response
      .writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
      .end(
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          ok: false,
        }),
      );
  }
  }).listen(port, host, () => {
    console.log(`Inbox Admin QA: http://${host}:${port}/legacy/inbox-admin.html`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
