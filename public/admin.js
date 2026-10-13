const ADMIN_SESSION_KEY = "shelfnotes.admin-token";
const LEGACY_STORAGE_KEY = "shelfnotes.books.v1";
const MIGRATION_KEY = "shelfnotes.database-migrated.v2";
const $ = (selector) => document.querySelector(selector);
let books = [];
let editingBookId = null;
let toastTimer;

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tagsFor(book) { return Array.isArray(book.tags) && book.tags.length ? book.tags : [book.genre].filter(Boolean); }
function chaptersFor(book) { return Array.isArray(book.chapters) ? book.chapters : []; }

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = sessionStorage.getItem(ADMIN_SESSION_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text || "{}"); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed with HTTP ${response.status}`);
  return payload;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function setNotice(message = "") {
  $("#admin-notice").textContent = message;
  $("#admin-notice").hidden = !message;
}

function dateToday() { return new Date().toISOString().slice(0, 10); }

function displayDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { day:"numeric", month:"short", year:"numeric" }).format(date);
}

function adminBookCard(book) {
  const article = create("article", "admin-book-row");
  const cover = create("div", `admin-book-cover cover--${book.color}${book.coverUrl ? " has-image" : ""}`);
  if (book.coverUrl) {
    const image = create("img", "cover-image");
    image.src = book.coverUrl;
    image.alt = `Cover of ${book.title}`;
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove());
    cover.append(image);
  } else {
    cover.append(create("span", "", book.title.slice(0, 1).toLocaleUpperCase()));
  }
  const content = create("div", "admin-book-content");
  const heading = create("div", "admin-book-heading");
  const title = create("div");
  title.append(create("h3", "", book.title), create("p", "", `by ${book.author}`));
  heading.append(title, create("span", "admin-book-date", displayDate(book.finishedAt)));
  const tags = create("div", "tag-list");
  tags.append(...tagsFor(book).map((tag) => create("span", "tag tag--plain", tag)));
  const detail = create("p", "admin-book-detail", `${chaptersFor(book).length} chapters · ${book.takeaways?.length || 0} takeaways${book.coverUrl ? " · cover stored" : " · no cover"}`);
  content.append(heading, tags, detail);
  const actions = create("div", "admin-row-actions");
  const edit = create("button", "button quiet", "Edit");
  edit.type = "button";
  edit.addEventListener("click", () => openBookForm(book));
  const remove = create("button", "button danger", "Delete");
  remove.type = "button";
  remove.addEventListener("click", () => deleteBook(book));
  actions.append(edit, remove);
  article.append(cover, content, actions);
  return article;
}

function render() {
  const query = $("#admin-search").value.trim().toLocaleLowerCase();
  const filtered = books.filter((book) => [book.title, book.author, ...tagsFor(book)].join(" ").toLocaleLowerCase().includes(query));
  $("#admin-books").replaceChildren(...filtered.map(adminBookCard));
  $("#admin-books").hidden = filtered.length === 0;
  $("#admin-empty").hidden = filtered.length !== 0;
  $("#admin-count").textContent = `${filtered.length} of ${books.length} ${books.length === 1 ? "record" : "records"}`;
}

async function loadBooks() {
  const result = await api("/api/books");
  books = result.books || [];
  render();
}

async function migrateLegacyBooks() {
  if (localStorage.getItem(MIGRATION_KEY)) return;
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]"); } catch { legacy = []; }
  if (!Array.isArray(legacy) || !legacy.length) return;
  const result = await api("/api/books/import", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ books:legacy }) });
  books = result.books || books;
  localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
  showToast(`Migrated ${result.imported} browser-only summaries into NEO DB.`);
}

async function unlock(token, announce = true) {
  sessionStorage.setItem(ADMIN_SESSION_KEY, token);
  try {
    await api("/api/admin/status");
    await loadBooks();
    setNotice("");
    try { await migrateLegacyBooks(); }
    catch (error) { setNotice(`Admin access is active, but browser-note migration failed: ${error.message}`); }
    render();
    $("#auth-panel").hidden = true;
    $("#admin-workspace").hidden = false;
    $("#sign-out").hidden = false;
    if (announce) showToast("Administrator access unlocked for this browser tab.");
    return true;
  } catch (error) {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    $("#auth-panel").hidden = false;
    $("#admin-workspace").hidden = true;
    $("#sign-out").hidden = true;
    setNotice(`Administrator access failed: ${error.message}`);
    return false;
  }
}

function lockAdmin() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  books = [];
  render();
  $("#admin-token").value = "";
  $("#auth-panel").hidden = false;
  $("#admin-workspace").hidden = true;
  $("#sign-out").hidden = true;
  setNotice("");
  showToast("Administrator access locked.");
}

function refreshChapterNumbers() {
  const fields = [...document.querySelectorAll(".chapter-field")];
  fields.forEach((field, index) => { field.querySelector(".chapter-number").textContent = `Chapter ${index + 1}`; });
  if (!fields.length) $("#chapter-fields").replaceChildren(create("p", "chapter-empty", "No chapter notes yet. Add a chapter or import chapter JSON."));
}

function addChapterField(chapter = {}) {
  const container = $("#chapter-fields");
  container.querySelector(".chapter-empty")?.remove();
  const field = create("article", "chapter-field");
  const number = create("p", "chapter-number");
  const remove = create("button", "chapter-remove", "Remove");
  remove.type = "button";
  remove.setAttribute("aria-label", "Remove chapter note");
  remove.addEventListener("click", () => { field.remove(); refreshChapterNumbers(); });
  const titleLabel = create("label");
  const titleInput = Object.assign(create("input"), { required:true, maxLength:160, value:String(chapter.title || ""), autocomplete:"off" });
  titleInput.className = "chapter-title";
  titleLabel.append("Chapter title", titleInput);
  const takeawayLabel = create("label");
  const takeawayInput = Object.assign(create("textarea"), { maxLength:3600, rows:3, value:Array.isArray(chapter.takeaways) ? chapter.takeaways.join("\n") : String(chapter.takeaways || ""), placeholder:"One core takeaway per line" });
  takeawayInput.className = "chapter-takeaways";
  takeawayLabel.append("Core takeaways", takeawayInput);
  const summaryLabel = create("label", "chapter-summary");
  const summaryInput = Object.assign(create("textarea"), { required:true, maxLength:4000, rows:4, value:String(chapter.summary || ""), placeholder:"What happens in this chapter, and why does it matter?" });
  summaryInput.className = "chapter-summary-input";
  summaryLabel.append("Chapter summary", summaryInput);
  field.append(number, remove, titleLabel, takeawayLabel, summaryLabel);
  container.append(field);
  refreshChapterNumbers();
}

function renderChapterFields(chapters = []) {
  $("#chapter-fields").replaceChildren();
  chapters.forEach(addChapterField);
  refreshChapterNumbers();
}

function readChapterFields() {
  return [...document.querySelectorAll(".chapter-field")].map((field) => ({
    title: field.querySelector(".chapter-title").value.trim(),
    summary: field.querySelector(".chapter-summary-input").value.trim(),
    takeaways: field.querySelector(".chapter-takeaways").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  }));
}

function openBookForm(book = null) {
  editingBookId = book?.id || null;
  $("#book-form").reset();
  $("#book-date").value = book?.finishedAt || dateToday();
  $("#form-eyebrow").textContent = book ? "Edit library record" : "New library record";
  $("#form-title").textContent = book ? "Edit book summary" : "Add a book summary";
  $("#form-description").textContent = book ? "Update metadata, tags, chapters, takeaways, or the stored cover." : "Create a searchable summary and optional chapter breakdown.";
  $("#cover-help").textContent = book?.coverUrl ? "Current cover is preserved unless you choose a replacement." : "Optional · JPEG, PNG, or WebP · maximum 5 MiB";
  $("#book-form").querySelector('[type="submit"]').textContent = book ? "Update summary" : "Save summary";
  if (book) {
    $("#book-title").value = book.title;
    $("#book-author").value = book.author;
    $("#book-tags").value = tagsFor(book).join(", ");
    $("#book-rating").value = String(book.rating);
    $("#book-color").value = book.color;
    $("#book-idea").value = book.bigIdea;
    $("#book-takeaways").value = (book.takeaways || []).join("\n");
    $("#book-quote").value = book.quote || "";
    $("#book-audience").value = book.audience;
  }
  renderChapterFields(book ? chaptersFor(book) : []);
  $("#book-dialog").showModal();
  $("#book-title").focus();
}

async function importChapterFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const chapters = Array.isArray(parsed) ? parsed : parsed?.chapters;
    if (!Array.isArray(chapters)) throw new Error('Use a JSON array or an object containing a "chapters" array.');
    if (chapters.length > 80) throw new Error("A book can contain at most 80 chapter notes.");
    chapters.forEach((chapter, index) => {
      if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) throw new Error(`Chapter ${index + 1} must be an object.`);
      if (!String(chapter.title || "").trim() || !String(chapter.summary || "").trim()) throw new Error(`Chapter ${index + 1} needs both title and summary.`);
    });
    const existing = document.querySelectorAll(".chapter-field").length;
    if (existing && !confirm(`Replace the ${existing} chapter fields currently in this form? Nothing is saved until you submit the book.`)) return;
    renderChapterFields(chapters);
    showToast(`Loaded ${chapters.length} chapter notes into the editor. Save the book to persist them.`);
  } catch (error) {
    showToast(`Chapter import failed: ${error.message}`);
  } finally {
    $("#chapter-import-file").value = "";
  }
}

async function uploadCover(book, file) {
  if (!file) return book;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Cover must be JPEG, PNG, or WebP.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Cover image must be 5 MiB or smaller.");
  return (await api(`/api/books/${encodeURIComponent(book.id)}/cover`, { method:"POST", headers:{ "Content-Type":file.type }, body:file })).book;
}

async function saveBook(event) {
  event.preventDefault();
  const isEditing = Boolean(editingBookId);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = isEditing ? "Updating…" : "Saving…";
  const form = new FormData(event.currentTarget);
  const cover = form.get("cover");
  const values = Object.fromEntries(form);
  delete values.cover;
  values.tags = String(values.tags).split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  values.takeaways = String(values.takeaways).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  values.chapters = readChapterFields();
  try {
    const path = isEditing ? `/api/books/${encodeURIComponent(editingBookId)}` : "/api/books";
    let result = await api(path, { method:isEditing ? "PUT" : "POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(values) });
    let coverWarning = "";
    if (cover?.size) {
      try { result.book = await uploadCover(result.book, cover); }
      catch (error) { coverWarning = ` The summary was saved, but its cover failed: ${error.message}`; }
    }
    books = [result.book, ...books.filter((book) => book.id !== result.book.id)];
    $("#book-dialog").close();
    editingBookId = null;
    render();
    showToast(`${isEditing ? "Book summary updated" : "Book summary added"}.${coverWarning}`);
  } catch (error) {
    showToast(`${isEditing ? "Update" : "Save"} failed: ${error.message}`);
  } finally {
    submit.disabled = false;
    submit.textContent = isEditing ? "Update summary" : "Save summary";
  }
}

async function deleteBook(book) {
  if (!confirm(`Delete “${book.title}” and its stored cover? This cannot be undone.`)) return;
  try {
    await api(`/api/books/${encodeURIComponent(book.id)}`, { method:"DELETE" });
    books = books.filter((item) => item.id !== book.id);
    render();
    showToast("Book summary deleted.");
  } catch (error) { showToast(`Delete failed: ${error.message}`); }
}

function exportBooks() {
  const blob = new Blob([JSON.stringify({ schemaVersion:4, appVersion:$("#admin-version").dataset.version || "", exportedAt:new Date().toISOString(), books }, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shelfnotes-${dateToday()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Library exported with tags and chapter notes.");
}

async function importBookFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const result = await api("/api/books/import", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(parsed) });
    books = result.books || [];
    $("#admin-search").value = "";
    render();
    showToast(`Merged ${result.imported} summaries. The library now has ${result.total} books.`);
  } catch (error) { showToast(`Library import failed: ${error.message}`); }
  finally { $("#import-file").value = ""; }
}

$("#auth-form").addEventListener("submit", async (event) => { event.preventDefault(); await unlock($("#admin-token").value.trim()); });
$("#sign-out").addEventListener("click", lockAdmin);
$("#admin-search").addEventListener("input", render);
$("#open-add").addEventListener("click", () => openBookForm());
$("#book-form").addEventListener("submit", saveBook);
$("#add-chapter").addEventListener("click", () => addChapterField());
$("#import-chapters").addEventListener("click", () => $("#chapter-import-file").click());
$("#chapter-import-file").addEventListener("change", (event) => importChapterFile(event.target.files[0]));
$("#export-books").addEventListener("click", exportBooks);
$("#import-books").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", (event) => importBookFile(event.target.files[0]));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close)?.close()));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));

renderChapterFields();
render();
api("/api/meta").then((meta) => {
  $("#admin-version").dataset.version = meta.version;
  $("#admin-version").textContent = `v${meta.version}${meta.revision ? ` · ${meta.revision.slice(0, 8)}` : ""}`;
}).catch(() => { $("#admin-version").textContent = "Version unavailable"; });
const existingToken = sessionStorage.getItem(ADMIN_SESSION_KEY);
if (existingToken) unlock(existingToken, false);
