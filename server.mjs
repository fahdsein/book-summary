import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function serveFile(request, response, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    json(response, 400, { error: "invalid_path" });
    return;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(PUBLIC_DIR, relative);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    json(response, 403, { error: "forbidden" });
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not_file");
    const extension = path.extname(file).toLowerCase();
    const cacheControl = extension === ".html" ? "no-cache" : "public, max-age=3600";
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Cache-Control": cacheControl,
      "Content-Type": TYPES.get(extension) || "application/octet-stream",
      "Content-Length": info.size
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch {
    json(response, 404, { error: "not_found" });
  }
}

export function startServer(port = Number(process.env.PORT || 3000)) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") {
      json(response, 200, { status: "ok", service: "shelfnotes" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/readyz") {
      json(response, 200, { status: "ready", service: "shelfnotes" });
      return;
    }
    if (["GET", "HEAD"].includes(request.method || "")) {
      await serveFile(request, response, url.pathname);
      return;
    }
    json(response, 405, { error: "method_not_allowed" });
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`ShelfNotes listening on 0.0.0.0:${server.address().port}`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = startServer();
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
