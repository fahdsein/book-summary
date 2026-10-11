import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.BOOK_STORAGE_MODE = "memory";
delete process.env.ADMIN_TOKEN;
delete process.env.NODE_ENV;

const { startServer } = await import("../server.mjs");
const server = startServer(0);
after(() => new Promise((resolve) => server.close(resolve)));

async function baseUrl() {
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const book = {
  title: "The Pragmatic Programmer",
  author: "Andrew Hunt and David Thomas",
  genre: "Technology",
  rating: 5,
  finishedAt: "2026-10-11",
  color: "blue",
  bigIdea: "Treat software development as a deliberate craft.",
  takeaways: ["Automate repetition", "Keep learning"],
  quote: "Care about your craft.",
  audience: "Software developers"
};

test("serves liveness and dependency-aware readiness probes", async () => {
  const base = await baseUrl();
  const health = await fetch(`${base}/healthz`);
  const ready = await fetch(`${base}/readyz`);
  assert.equal(health.status, 200);
  assert.equal(ready.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "shelfnotes" });
  assert.deepEqual(await ready.json(), { status: "ready", dependencies: { database: "memory", storage: "not_configured" } });
});

test("serves the app with security headers", async () => {
  const response = await fetch(`${await baseUrl()}/`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /ShelfNotes/);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
});

test("persists summaries and merges JSON imports without replacing existing books", async () => {
  const base = await baseUrl();
  const createdResponse = await fetch(`${base}/api/books`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(book)
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).book;

  const importedResponse = await fetch(`${base}/api/books/import`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books: [
      { ...book, id: created.id, title: "The Pragmatic Programmer — Updated" },
      { ...book, id: "second-book", title: "Designing Data-Intensive Applications", author: "Martin Kleppmann" }
    ] })
  });
  assert.equal(importedResponse.status, 200);
  const imported = await importedResponse.json();
  assert.equal(imported.strategy, "merge");
  assert.equal(imported.total, 2);

  const listed = (await (await fetch(`${base}/api/books`)).json()).books;
  assert.equal(listed.length, 2);
  assert.equal(listed.find((item) => item.id === created.id).title, "The Pragmatic Programmer — Updated");
  assert.ok(listed.some((item) => item.id === "second-book"));
});

test("rejects unsupported cover formats before accessing object storage", async () => {
  const response = await fetch(`${await baseUrl()}/api/books/second-book/cover`, {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "not an image"
  });
  assert.equal(response.status, 415);
});

test("protects production mutations with ADMIN_TOKEN", async () => {
  process.env.NODE_ENV = "production";
  process.env.ADMIN_TOKEN = "test-administrator-secret";
  try {
    const base = await baseUrl();
    const denied = await fetch(`${base}/api/books`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...book, title: "Denied" })
    });
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${base}/api/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-administrator-secret" },
      body: JSON.stringify({ ...book, title: "Authorized" })
    });
    assert.equal(allowed.status, 201);
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ADMIN_TOKEN;
  }
});

test("rejects unsupported methods and missing files", async () => {
  const base = await baseUrl();
  assert.equal((await fetch(`${base}/missing.txt`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
});
