import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, databaseReady, getBook, importBooks, listBooks, removeBook, saveBook, setBookCover } from "./lib/database.mjs";
import { deleteCover, readCover, storageReady, uploadCover, validateCoverType } from "./lib/storage.mjs";
import { validateBook, validateImport } from "./lib/validation.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const APP_VERSION = process.env.APP_VERSION || PACKAGE.version;
const BUILD_REVISION = String(process.env.BUILD_REVISION || "").slice(0, 40);
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const TYPES = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".svg", "image/svg+xml; charset=utf-8"]
]);
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { ...SECURITY_HEADERS, "Cache-Control":"no-store", "Content-Type":"application/json; charset=utf-8", "Content-Length":Buffer.byteLength(body) });
  response.end(body);
}

async function readBody(request, maximum) {
  if (Number(request.headers["content-length"] || 0) > maximum) {
    const error = new Error(`Request body exceeds ${Math.round(maximum / 1024 / 1024)} MiB`); error.status = 413; throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) { const error = new Error(`Request body exceeds ${Math.round(maximum / 1024 / 1024)} MiB`); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const raw = await readBody(request, MAX_JSON_BYTES);
  try { return JSON.parse(raw.toString("utf8") || "{}"); }
  catch { const error = new Error("Request body must be valid JSON"); error.status = 400; throw error; }
}

function publicBook(book) {
  return { ...book, coverUrl:book.coverKey ? `/api/covers/${encodeURIComponent(book.coverKey)}` : "" };
}

function safeId(value) {
  const id = decodeURIComponent(String(value || ""));
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(id)) { const error = new Error("Invalid book identifier"); error.status = 400; throw error; }
  return id;
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function mutationAuthorized(request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production" ? { ok:true } : { ok:false, status:503, error:"admin_token_not_configured" };
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  return safeEqual(supplied, expected) ? { ok:true } : { ok:false, status:401, error:"administrator_access_required" };
}

async function handleApi(request, response, url) {
  if (["POST", "PUT", "DELETE"].includes(request.method || "")) {
    const authorization = mutationAuthorized(request);
    if (!authorization.ok) { json(response, authorization.status, { error:authorization.error }); return true; }
  }
  if (request.method === "GET" && url.pathname === "/api/books") {
    json(response, 200, { books:(await listBooks()).map(publicBook) }); return true;
  }
  if (request.method === "GET" && url.pathname === "/api/admin/status") {
    const authorization = mutationAuthorized(request);
    if (!authorization.ok) { json(response, authorization.status, { error:authorization.error }); return true; }
    json(response, 200, { authorized:true }); return true;
  }
  if (request.method === "GET" && url.pathname === "/api/meta") {
    json(response, 200, { name:"ShelfNotes", version:APP_VERSION, revision:BUILD_REVISION }); return true;
  }
  if (request.method === "POST" && url.pathname === "/api/books") {
    const book = validateBook(await readJson(request), { allowId:false });
    json(response, 201, { book:publicBook(await saveBook(book)) }); return true;
  }
  if (request.method === "POST" && url.pathname === "/api/books/import") {
    const imported = validateImport(await readJson(request));
    const books = await importBooks(imported);
    json(response, 200, { imported:imported.length, total:books.length, strategy:"merge", books:books.map(publicBook) }); return true;
  }
  const coverMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/cover$/);
  if (request.method === "POST" && coverMatch) {
    const id = safeId(coverMatch[1]);
    const existing = await getBook(id);
    if (!existing) { json(response, 404, { error:"book_not_found" }); return true; }
    const contentType = validateCoverType(request.headers["content-type"]).contentType;
    const buffer = await readBody(request, MAX_COVER_BYTES);
    if (!buffer.length) { const error = new Error("Cover image is empty"); error.status = 400; throw error; }
    const uploaded = await uploadCover(id, buffer, contentType);
    const updated = await setBookCover(id, uploaded.key, uploaded.contentType);
    if (existing.coverKey && existing.coverKey !== uploaded.key) await deleteCover(existing.coverKey).catch(() => {});
    json(response, 200, { book:publicBook(updated) }); return true;
  }
  const bookMatch = url.pathname.match(/^\/api\/books\/([^/]+)$/);
  if (request.method === "PUT" && bookMatch) {
    const id = safeId(bookMatch[1]);
    if (!await getBook(id)) { json(response, 404, { error:"book_not_found" }); return true; }
    const book = validateBook({ ...(await readJson(request)), id });
    json(response, 200, { book:publicBook(await saveBook(book)) }); return true;
  }
  if (request.method === "DELETE" && bookMatch) {
    const id = safeId(bookMatch[1]);
    const existing = await getBook(id);
    if (!existing) { json(response, 404, { error:"book_not_found" }); return true; }
    await removeBook(id);
    await deleteCover(existing.coverKey).catch(() => {});
    json(response, 200, { deleted:true, id }); return true;
  }
  const imageMatch = url.pathname.match(/^\/api\/covers\/(.+)$/);
  if (request.method === "GET" && imageMatch) {
    const key = decodeURIComponent(imageMatch[1]);
    if (!/^book-cover-[a-zA-Z0-9._-]+$/.test(key)) { json(response, 400, { error:"invalid_cover_key" }); return true; }
    const object = await readCover(key);
    response.writeHead(200, { ...SECURITY_HEADERS, "Cache-Control":object.CacheControl || "public, max-age=3600", "Content-Type":object.ContentType || "application/octet-stream", ...(object.ContentLength ? { "Content-Length":object.ContentLength } : {}) });
    object.Body.pipe(response); return true;
  }
  return false;
}

async function serveFile(request, response, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { json(response, 400, { error:"invalid_path" }); return; }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(PUBLIC_DIR, relative);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) { json(response, 403, { error:"forbidden" }); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not_file");
    const extension = path.extname(file).toLowerCase();
    response.writeHead(200, { ...SECURITY_HEADERS, "Cache-Control":extension === ".html" ? "no-cache" : "public, max-age=3600", "Content-Type":TYPES.get(extension) || "application/octet-stream", "Content-Length":info.size });
    if (request.method === "HEAD") response.end(); else createReadStream(file).pipe(response);
  } catch { json(response, 404, { error:"not_found" }); }
}

function apiError(response, error) {
  const configError = ["DATABASE_NOT_CONFIGURED", "S3_NOT_CONFIGURED"].includes(error.code);
  const status = error.status || (configError ? 503 : 500);
  if (status >= 500 && !configError) console.error("Request failed:", error);
  json(response, status, { error:configError ? error.code.toLowerCase() : (status >= 500 ? "internal_server_error" : error.message), ...(configError ? { message:error.message } : {}) });
}

export function startServer(port = Number(process.env.PORT || 3000)) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") { json(response, 200, { status:"ok", service:"shelfnotes", version:APP_VERSION }); return; }
    if (request.method === "GET" && url.pathname === "/readyz") {
      const dependencies = { database:"unknown", storage:"unknown" };
      try { dependencies.database = (await databaseReady()).mode; } catch { dependencies.database = "unavailable"; }
      try { dependencies.storage = (await storageReady()).mode; } catch { dependencies.storage = "unavailable"; }
      const ready = dependencies.database !== "unavailable" && (process.env.NODE_ENV !== "production" || dependencies.storage === "s3");
      json(response, ready ? 200 : 503, { status:ready ? "ready" : "degraded", dependencies }); return;
    }
    try {
      if (url.pathname.startsWith("/api/") && await handleApi(request, response, url)) return;
      if (["GET", "HEAD"].includes(request.method || "")) { await serveFile(request, response, url.pathname); return; }
      json(response, 405, { error:"method_not_allowed" });
    } catch (error) { apiError(response, error); }
  });
  server.listen(port, "0.0.0.0", () => console.log(`ShelfNotes listening on 0.0.0.0:${server.address().port}`));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = startServer();
  const shutdown = () => server.close(() => closeDatabase().finally(() => process.exit(0)));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
