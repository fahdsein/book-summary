import { readFile } from "node:fs/promises";

const required = [".env.example", "Dockerfile", "server.mjs", "lib/database.mjs", "lib/storage.mjs", "lib/validation.mjs", "public/index.html", "public/admin.html", "public/styles.css", "public/app.js", "public/admin.js", "public/fonts/inter-latin-variable.woff2", "public/fonts/literata-latin-variable.woff2", "public/fonts/Inter-OFL.txt", "public/fonts/Literata-OFL.txt"];
for (const file of required) await readFile(new URL(`../${file}`, import.meta.url));

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
for (const id of ["books-grid", "search", "tag-filters", "pagination", "local-time", "random-quote", "detail-dialog", "detail-chapters", "detail-editions", "theme-select", "reader-font", "reader-size", "reader-leading", "reader-page", "app-version"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required UI element: ${id}`);
}

const adminHtml = await readFile(new URL("../public/admin.html", import.meta.url), "utf8");
for (const id of ["auth-form", "admin-workspace", "admin-books", "book-dialog", "book-form", "book-tags", "book-pdf-url", "book-pdf-file", "media-dialog", "media-covers", "chapter-fields", "import-chapters", "chapter-import-file", "admin-version"]) {
  if (!adminHtml.includes(`id="${id}"`)) throw new Error(`Missing required admin UI element: ${id}`);
}

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
for (const endpoint of ["/healthz", "/readyz", "/api/books", "/api/covers", "/api/admin/books", "/pdf", "/api/meta", "/api/admin/status", "0.0.0.0"]) {
  if (!server.includes(endpoint)) throw new Error(`Missing deployment requirement: ${endpoint}`);
}

console.log(`ShelfNotes validation passed (${required.length} deployment files).`);
