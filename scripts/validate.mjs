import { readFile } from "node:fs/promises";

const required = [".env.example", "Dockerfile", "server.mjs", "lib/database.mjs", "lib/storage.mjs", "lib/validation.mjs", "public/index.html", "public/styles.css", "public/app.js"];
for (const file of required) await readFile(new URL(`../${file}`, import.meta.url));

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
for (const id of ["books-grid", "search", "genre-filters", "book-dialog", "book-form", "book-cover", "chapter-fields", "add-chapter", "edit-book", "detail-chapters", "admin-dialog", "theme-select"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required UI element: ${id}`);
}

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
for (const endpoint of ["/healthz", "/readyz", "/api/books", "/api/covers", "0.0.0.0"]) {
  if (!server.includes(endpoint)) throw new Error(`Missing deployment requirement: ${endpoint}`);
}

console.log(`ShelfNotes validation passed (${required.length} deployment files).`);
