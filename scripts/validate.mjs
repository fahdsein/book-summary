import { readFile } from "node:fs/promises";

const required = [".env.example", "Dockerfile", "server.mjs", "lib/database.mjs", "lib/storage.mjs", "lib/validation.mjs", "public/index.html", "public/admin.html", "public/styles.css", "public/app.js", "public/admin.js"];
for (const file of required) await readFile(new URL(`../${file}`, import.meta.url));

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
for (const id of ["books-grid", "search", "tag-filters", "detail-dialog", "detail-chapters", "theme-select", "app-version"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required UI element: ${id}`);
}

const adminHtml = await readFile(new URL("../public/admin.html", import.meta.url), "utf8");
for (const id of ["auth-form", "admin-workspace", "admin-books", "book-dialog", "book-form", "book-tags", "chapter-fields", "import-chapters", "chapter-import-file", "admin-version"]) {
  if (!adminHtml.includes(`id="${id}"`)) throw new Error(`Missing required admin UI element: ${id}`);
}

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
for (const endpoint of ["/healthz", "/readyz", "/api/books", "/api/covers", "/api/meta", "/api/admin/status", "0.0.0.0"]) {
  if (!server.includes(endpoint)) throw new Error(`Missing deployment requirement: ${endpoint}`);
}

console.log(`ShelfNotes validation passed (${required.length} deployment files).`);
