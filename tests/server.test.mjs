import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.BOOK_STORAGE_MODE = "memory";
delete process.env.ADMIN_TOKEN;
delete process.env.NODE_ENV;

const { startServer } = await import("../server.mjs");
const { addBookCover,legacyCoverFromRow,updateBookEdition } = await import("../lib/database.mjs");
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
  collections: ["Work references", "Read again"],
  favorite: true,
  rating: 5,
  finishedAt: "2026-10-11",
  color: "blue",
  bigIdea: "Treat software development as a deliberate craft.",
  takeaways: ["Automate repetition", "Keep learning"],
  chapters: [{
    title: "A Pragmatic Philosophy",
    summary: "Build responsibility, adaptability, and ownership into everyday work.",
    takeaways: ["Own the outcome", "Fix broken windows"]
  }],
  quote: "Care about your craft.",
  audience: "Software developers"
};

test("serves liveness and dependency-aware readiness probes", async () => {
  const base = await baseUrl();
  const health = await fetch(`${base}/healthz`);
  const ready = await fetch(`${base}/readyz`);
  assert.equal(health.status, 200);
  assert.equal(ready.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "shelfnotes", version: "5.0.0" });
  assert.deepEqual(await ready.json(), { status: "ready", dependencies: { database: "memory", storage: "not_configured" } });
});

test("publishes non-secret application version metadata", async () => {
  const response = await fetch(`${await baseUrl()}/api/meta`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: "ShelfNotes", version: "5.0.0", revision: "", booksPerPage:12, maxCoversPerBook:8, maxPdfBytes:26214400 });
});

test("serves self-hosted reading fonts with the correct content type", async () => {
  const response = await fetch(`${await baseUrl()}/fonts/literata-latin-variable.woff2`);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("content-type"),"font/woff2");
  assert.ok(Number(response.headers.get("content-length"))>80_000);
});

test("keeps a legacy cover visible when the relational cover backfill has not run", () => {
  const createdAt = new Date("2026-10-01T08:00:00.000Z");
  assert.deepEqual(legacyCoverFromRow({
    id:"thinking-fast-and-slow",
    cover_key:"book-covers/thinking-fast-and-slow/original.webp",
    cover_content_type:"image/webp",
    created_at:createdAt
  }), {
    coverId:"legacy-thinking-fast-and-slow",
    bookId:"thinking-fast-and-slow",
    editionLabel:"Default edition",
    position:1,
    objectKey:"book-covers/thinking-fast-and-slow/original.webp",
    contentType:"image/webp",
    isbn10:"",
    isbn13:"",
    publisher:"",
    publicationYear:null,
    language:"",
    format:"",
    pageCount:null,
    createdAt:createdAt.toISOString()
  });
  assert.equal(legacyCoverFromRow({ id:"without-cover",cover_key:"" }),null);
});

test("serves the app with security headers", async () => {
  const response = await fetch(`${await baseUrl()}/`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /ShelfNotes/);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
});

test("serves the admin page without requiring a file extension", async () => {
  const base = await baseUrl();
  for (const pathname of ["/admin", "/admin/"]) {
    const response = await fetch(`${base}${pathname}`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.match(body, /Admin/);
  }

  const head = await fetch(`${base}/admin`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type"), /^text\/html/);
});

test("imports, publishes, lists, and deletes a custom theme", async () => {
  const base = await baseUrl();
  const theme = { id:"forest-study",name:"Forest Study",tokens:{bg:"#eef3ed",surface:"#ffffff",surface2:"#dfe9df",ink:"#203128",muted:"#627269",accent:"#376b4d",accent2:"#b98b45",line:"#cad8cd",danger:"#a4433e",coverInk:"#ffffff",themeColor:"#eef3ed"} };
  const imported = await fetch(`${base}/api/admin/themes`, { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(theme) });
  assert.equal(imported.status,200);
  assert.equal((await imported.json()).theme.name,"Forest Study");

  const published = await fetch(`${base}/api/admin/themes/active`, { method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:theme.id}) });
  assert.equal(published.status,200);
  const publicThemes = await (await fetch(`${base}/api/themes`)).json();
  assert.equal(publicThemes.activeThemeId,theme.id);
  assert.equal(publicThemes.themes[0].tokens.accent,"#376b4d");

  assert.equal((await fetch(`${base}/api/admin/themes/${theme.id}`,{method:"DELETE"})).status,200);
  const afterDelete = await (await fetch(`${base}/api/themes`)).json();
  assert.equal(afterDelete.activeThemeId,"");
  assert.equal(afterDelete.themes.length,0);
});

test("rejects unsafe or incomplete custom theme JSON", async () => {
  const response = await fetch(`${await baseUrl()}/api/admin/themes`, { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:"unsafe",name:"Unsafe",tokens:{bg:"url(https://example.com)"}}) });
  assert.equal(response.status,400);
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
      { ...book, id: "second-book", title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", tags: ["Technology", "Databases", "Distributed Systems"] }
    ] })
  });
  assert.equal(importedResponse.status, 200);
  const imported = await importedResponse.json();
  assert.equal(imported.strategy, "merge");
  assert.equal(imported.total, 2);

  const listed = (await (await fetch(`${base}/api/books`)).json()).books;
  assert.equal(listed.length, 2);
  assert.equal(listed.find((item) => item.id === created.id).title, "The Pragmatic Programmer — Updated");
  assert.equal(listed.find((item) => item.id === created.id).chapters[0].title, "A Pragmatic Philosophy");
  assert.deepEqual(listed.find((item) => item.id === created.id).tags, ["Technology"]);
  assert.deepEqual(listed.find((item) => item.id === created.id).collections, ["Work references", "Read again"]);
  assert.equal(listed.find((item) => item.id === created.id).favorite, true);
  assert.deepEqual(listed.find((item) => item.id === "second-book").tags, ["Technology", "Databases", "Distributed Systems"]);
  assert.ok(listed.some((item) => item.id === "second-book"));
});

test("stores structured edition metadata and publishes it with the cover", async () => {
  await addBookCover("second-book","book-covers/second-book/test.webp","image/webp","First edition");
  const adminBefore=(await (await fetch(`${await baseUrl()}/api/admin/books`)).json()).books.find((item)=>item.id==="second-book");
  const cover=adminBefore.covers[0];
  const response=await fetch(`${await baseUrl()}/api/books/second-book/covers/${cover.coverId}`,{
    method:"PATCH",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({editionLabel:"International paperback",isbn10:"0132350882",isbn13:"9780132350884",publisher:"Prentice Hall",publicationYear:2008,language:"English",format:"Paperback",pageCount:464})
  });
  assert.equal(response.status,200);
  const edition=(await response.json()).book.covers[0];
  assert.equal(edition.editionLabel,"International paperback");
  assert.equal(edition.isbn13,"9780132350884");
  assert.equal(edition.pageCount,464);
  const stored=await updateBookEdition("second-book",cover.coverId,{...edition,editionLabel:"Updated edition"});
  assert.equal(stored.editionLabel,"Updated edition");
});

test("lets an administrator edit an existing summary and its chapter breakdown", async () => {
  const base = await baseUrl();
  const before = (await (await fetch(`${base}/api/books`)).json()).books.find((item) => item.id === "second-book");
  const response = await fetch(`${base}/api/books/second-book`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...before,
      tags: ["Technology", "Architecture"],
      bigIdea: "Reliable systems are built by understanding data, distribution, and trade-offs.",
      chapters: [
        { title: "Reliable, Scalable, Maintainable", summary: "Defines the three core goals of data systems.", takeaways: ["Reliability is fault tolerance"] },
        { title: "Data Models", summary: "Compares relational, document, and graph models.", takeaways: ["Choose a model for access patterns"] }
      ]
    })
  });
  assert.equal(response.status, 200);
  const updated = (await response.json()).book;
  assert.equal(updated.chapters.length, 2);
  assert.deepEqual(updated.tags, ["Technology", "Architecture"]);
  assert.match(updated.bigIdea, /Reliable systems/);
});

test("keeps optional PDF metadata out of the public library response", async () => {
  const base = await baseUrl();
  const before = (await (await fetch(`${base}/api/books`)).json()).books.find((item) => item.id === "second-book");
  const updatedResponse = await fetch(`${base}/api/books/second-book`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...before, pdfUrl: "https://example.com/private-book.pdf" })
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).book.pdf.type, "url");

  const publicBook = (await (await fetch(`${base}/api/books`)).json()).books.find((item) => item.id === "second-book");
  assert.equal("pdf" in publicBook, false);
  assert.equal("pdfUrl" in publicBook, false);
  assert.equal("pdfKey" in publicBook, false);

  const adminBook = (await (await fetch(`${base}/api/admin/books`)).json()).books.find((item) => item.id === "second-book");
  assert.deepEqual(adminBook.pdf, { type:"url", name:"External PDF", url:"https://example.com/private-book.pdf" });
});

test("rejects fake PDF bytes before accessing object storage", async () => {
  const response = await fetch(`${await baseUrl()}/api/books/second-book/pdf`, {
    method: "POST", headers: { "Content-Type": "application/pdf", "X-File-Name": "sample.pdf" }, body: "not a pdf"
  });
  assert.equal(response.status, 415);
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
    const deniedStatus = await fetch(`${base}/api/admin/status`);
    assert.equal(deniedStatus.status, 401);
    const deniedAdminBooks = await fetch(`${base}/api/admin/books`);
    assert.equal(deniedAdminBooks.status, 401);
    const allowedStatus = await fetch(`${base}/api/admin/status`, { headers: { Authorization: "Bearer test-administrator-secret" } });
    assert.equal(allowedStatus.status, 200);
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
