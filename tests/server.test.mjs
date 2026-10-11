import assert from "node:assert/strict";
import { after, test } from "node:test";
import { startServer } from "../server.mjs";

const server = startServer(0);
after(() => new Promise((resolve) => server.close(resolve)));

async function baseUrl() {
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("serves liveness and readiness probes", async () => {
  const base = await baseUrl();
  const health = await fetch(`${base}/healthz`);
  const ready = await fetch(`${base}/readyz`);
  assert.equal(health.status, 200);
  assert.equal(ready.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "shelfnotes" });
  assert.deepEqual(await ready.json(), { status: "ready", service: "shelfnotes" });
});

test("serves the app with security headers", async () => {
  const response = await fetch(`${await baseUrl()}/`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /ShelfNotes/);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
});

test("rejects unsupported methods and missing files", async () => {
  const base = await baseUrl();
  assert.equal((await fetch(`${base}/missing.txt`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
});
