import { readFile } from "node:fs/promises";

const required = [".env.example", "Dockerfile", "server.mjs", "lib/database.mjs", "lib/storage.mjs", "lib/validation.mjs", "public/index.html", "public/graph.html", "public/admin.html", "public/themes-admin.html", "public/styles.css", "public/graph.css", "public/app.js", "public/graph.js", "public/admin.js", "public/themes-admin.js", "public/fonts/inter-latin-variable.woff2", "public/fonts/literata-latin-variable.woff2", "public/fonts/Inter-OFL.txt", "public/fonts/Literata-OFL.txt"];
for (const file of required) await readFile(new URL(`../${file}`, import.meta.url));

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
for (const id of ["books-grid", "search", "tag-filters", "collection-filter", "rating-filter", "favorite-filter", "sort-books", "page-size", "clear-filters", "pagination", "local-time", "random-quote", "detail-dialog", "detail-chapters", "detail-editions", "detail-edition-meta", "theme-select", "reader-font", "reader-size", "reader-leading", "reader-page", "app-version"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required UI element: ${id}`);
}
for (const theme of ["minimalist","cosmic","paper-journal","aurora"]) {
  if (!html.includes(`value="${theme}"`)) throw new Error(`Missing color-theme option: ${theme}`);
}

const adminHtml = await readFile(new URL("../public/admin.html", import.meta.url), "utf8");
for (const id of ["auth-form", "admin-workspace", "admin-books", "admin-sort", "admin-page-size", "admin-pagination", "book-dialog", "book-form", "book-tags", "book-collections", "book-favorite", "book-pdf-url", "book-pdf-file", "media-dialog", "media-covers", "edition-dialog", "edition-form", "chapter-fields", "import-chapters", "chapter-import-file", "admin-version"]) {
  if (!adminHtml.includes(`id="${id}"`)) throw new Error(`Missing required admin UI element: ${id}`);
}

const themesAdminHtml = await readFile(new URL("../public/themes-admin.html", import.meta.url), "utf8");
for (const id of ["auth-form", "admin-workspace", "theme-search", "theme-page-size", "theme-list", "theme-pagination", "import-theme", "theme-import-file", "admin-version"]) {
  if (!themesAdminHtml.includes(`id="${id}"`)) throw new Error(`Missing required theme admin UI element: ${id}`);
}

const graphHtml = await readFile(new URL("../public/graph.html", import.meta.url), "utf8");
for (const id of ["graph-search", "graph-collection", "graph-limit", "show-topics", "show-authors", "knowledge-graph", "graph-detail", "graph-list", "graph-reset"]) {
  if (!graphHtml.includes(`id="${id}"`)) throw new Error(`Missing required graph UI element: ${id}`);
}

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
for (const endpoint of ["/healthz", "/readyz", "/api/books", "/api/covers", "/api/admin/books", "/pdf", "/api/meta", "/api/admin/status", "0.0.0.0"]) {
  if (!server.includes(endpoint)) throw new Error(`Missing deployment requirement: ${endpoint}`);
}

console.log(`ShelfNotes validation passed (${required.length} deployment files).`);
