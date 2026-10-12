const LEGACY_STORAGE_KEY = "shelfnotes.books.v1";
const MIGRATION_KEY = "shelfnotes.database-migrated.v2";
const THEME_KEY = "shelfnotes.theme.v1";
const ADMIN_SESSION_KEY = "shelfnotes.admin-token";
const THEMES = new Set(["system", "vintage", "midnight", "matcha", "terracotta", "nordic", "lavender", "anthropologist", "autumn", "monolith", "seaside"]);
const $ = (selector) => document.querySelector(selector);
let books = [];
let activeGenre = "All";
let activeBookId = null;
let editingBookId = null;
let toastTimer;

function dateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

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

function setNotice(message = "") {
  const notice = $("#service-notice");
  notice.textContent = message;
  notice.hidden = !message;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
}

function localBooks() {
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

async function loadLibrary() {
  setNotice("");
  try {
    const initial = await api("/api/books");
    books = initial.books || [];
  } catch (error) {
    books = localBooks();
    setNotice(`Persistent storage is unavailable: ${error.message}. Existing browser notes are shown read-only; attach NEO DB and Object Storage, then redeploy.`);
    render();
    return;
  }

  const legacy = localBooks();
  if (!localStorage.getItem(MIGRATION_KEY) && legacy.length && sessionStorage.getItem(ADMIN_SESSION_KEY)) {
    try {
      const migrated = await api("/api/books/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books: legacy }) });
      books = migrated.books || books;
      localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
      showToast(`Migrated ${migrated.imported} browser summaries into NEO DB.`);
    } catch (error) {
      setNotice(`The database is available, but browser-note migration failed: ${error.message}. Check ADMIN_TOKEN and try Admin access again.`);
    }
  } else if (!localStorage.getItem(MIGRATION_KEY) && legacy.length) {
    setNotice("Existing browser-only summaries are available to migrate. Choose Admin access, enter ADMIN_TOKEN, then the app will merge them into NEO DB.");
  }
  render();
}

function displayDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ratingText(rating) { return "★".repeat(rating) + "☆".repeat(5 - rating); }
function chapterList(book) { return Array.isArray(book.chapters) ? book.chapters : []; }

function bookCard(book) {
  const article = create("article", "book-card");
  const button = create("button", "book-open");
  button.type = "button";
  button.setAttribute("aria-label", `Open summary for ${book.title}`);
  button.addEventListener("click", () => openDetails(book.id));

  const cover = create("div", `book-cover cover--${book.color}${book.coverUrl ? " has-image" : ""}`);
  if (book.coverUrl) {
    const image = create("img", "cover-image");
    image.src = book.coverUrl;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => { image.remove(); cover.classList.remove("has-image"); });
    cover.append(image);
  }
  cover.append(create("span", "badge", book.genre));
  const titleGroup = create("div");
  titleGroup.append(create("h3", "", book.title), create("p", "", `by ${book.author}`));
  cover.append(titleGroup);

  const note = create("div", "book-note");
  note.append(create("p", "", book.bigIdea));
  const meta = create("div", "book-meta");
  const stars = create("span", "stars", ratingText(book.rating));
  stars.setAttribute("aria-label", `${book.rating} out of 5 stars`);
  const chapters = chapterList(book).length;
  meta.append(stars, create("span", "", chapters ? `${chapters} ch · ${displayDate(book.finishedAt)}` : displayDate(book.finishedAt)));
  note.append(meta);
  button.append(cover, note);
  article.append(button);
  return article;
}

function visibleBooks() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  return books.filter((book) => {
    const genreMatches = activeGenre === "All" || book.genre === activeGenre;
    const chapterText = chapterList(book).flatMap((chapter) => [chapter.title, chapter.summary, ...(chapter.takeaways || [])]);
    const searchable = [book.title, book.author, book.genre, book.bigIdea, book.audience, ...book.takeaways, ...chapterText].join(" ").toLocaleLowerCase();
    return genreMatches && (!query || searchable.includes(query));
  });
}

function renderFilters() {
  const genres = ["All", ...new Set(books.map((book) => book.genre).sort((a, b) => a.localeCompare(b)))];
  if (!genres.includes(activeGenre)) activeGenre = "All";
  $("#genre-filters").replaceChildren(...genres.map((genre) => {
    const button = create("button", `filter${genre === activeGenre ? " active" : ""}`, genre === "All" ? "All books" : genre);
    button.type = "button";
    button.setAttribute("aria-pressed", String(genre === activeGenre));
    button.addEventListener("click", () => { activeGenre = genre; render(); });
    return button;
  }));
}

function readingStreak() {
  const dates = [...new Set(books.map((book) => book.finishedAt))].sort().reverse();
  if (!dates.length) return 0;
  let count = 1;
  let previous = new Date(`${dates[0]}T12:00:00`);
  for (const value of dates.slice(1)) {
    const current = new Date(`${value}T12:00:00`);
    if (Math.round((previous - current) / 86400000) !== 1) break;
    count += 1;
    previous = current;
  }
  return count;
}

function updateStats() {
  $("#stat-books").textContent = books.length;
  $("#stat-streak").textContent = readingStreak();
  const counts = new Map();
  for (const book of books) counts.set(book.genre, (counts.get(book.genre) || 0) + 1);
  $("#stat-genre").textContent = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "—";
}

function render() {
  renderFilters();
  updateStats();
  const filtered = visibleBooks();
  $("#books-grid").replaceChildren(...filtered.map(bookCard));
  $("#books-grid").hidden = filtered.length === 0;
  $("#empty-state").hidden = filtered.length !== 0;
  $("#result-count").textContent = `${filtered.length} of ${books.length} ${books.length === 1 ? "book" : "books"}`;
}

function chapterNote(chapter, index) {
  const article = create("article", "chapter-note");
  article.append(create("h4", "", `Chapter ${index + 1} · ${chapter.title}`), create("p", "", chapter.summary));
  if (chapter.takeaways?.length) {
    const list = create("ul", "takeaways");
    list.append(...chapter.takeaways.map((value) => create("li", "", value)));
    article.append(list);
  }
  return article;
}

function openDetails(id) {
  const book = books.find((item) => item.id === id);
  if (!book) return;
  activeBookId = id;
  const cover = $("#detail-cover");
  cover.className = `detail-cover cover--${book.color}${book.coverUrl ? " has-image" : ""}`;
  cover.style.backgroundImage = book.coverUrl ? `url("${book.coverUrl}")` : "";
  $("#detail-genre").textContent = book.genre;
  $("#detail-date").textContent = `Finished ${displayDate(book.finishedAt)}`;
  $("#detail-title").textContent = book.title;
  $("#detail-author").textContent = `by ${book.author}`;
  $("#detail-rating").textContent = ratingText(book.rating);
  $("#detail-rating").setAttribute("aria-label", `${book.rating} out of 5 stars`);
  $("#detail-idea").textContent = book.bigIdea;
  $("#detail-takeaways").replaceChildren(...book.takeaways.map((value) => create("li", "", value)));
  const chapters = chapterList(book);
  $("#detail-chapters-section").hidden = chapters.length === 0;
  $("#detail-chapter-count").textContent = `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}`;
  $("#detail-chapters").replaceChildren(...chapters.map(chapterNote));
  $("#detail-quote").textContent = book.quote ? `“${book.quote}”` : "No memorable line was recorded.";
  $("#detail-audience").textContent = book.audience;
  updateAdminState();
  $("#detail-dialog").showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function refreshChapterNumbers() {
  const fields = [...document.querySelectorAll(".chapter-field")];
  fields.forEach((field, index) => { field.querySelector(".chapter-number").textContent = `Chapter ${index + 1}`; });
  if (!fields.length) $("#chapter-fields").replaceChildren(create("p", "chapter-empty", "No chapter notes yet. Add only the chapters you want to remember."));
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

  const titleLabel = create("label", "");
  titleLabel.append("Chapter title", Object.assign(create("input"), { required: true, maxLength: 160, value: chapter.title || "", autocomplete: "off" }));
  titleLabel.querySelector("input").className = "chapter-title";
  const takeawayLabel = create("label", "");
  const takeawayInput = Object.assign(create("textarea"), { maxLength: 3600, rows: 3, value: (chapter.takeaways || []).join("\n"), placeholder: "One core takeaway per line" });
  takeawayInput.className = "chapter-takeaways";
  takeawayLabel.append("Core takeaways", takeawayInput);
  const summaryLabel = create("label", "chapter-summary");
  const summaryInput = Object.assign(create("textarea"), { required: true, maxLength: 4000, rows: 4, value: chapter.summary || "", placeholder: "What happens in this chapter, and why does it matter?" });
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

function prepareBookForm(book = null) {
  editingBookId = book?.id || null;
  $("#book-form").reset();
  $("#book-date").value = book?.finishedAt || dateOffset(0);
  $("#form-eyebrow").textContent = book ? "Administrator edit" : "New reading note";
  $("#form-title").textContent = book ? "Edit book summary" : "Add a book summary";
  $("#form-description").textContent = book ? "Update the summary, add chapter notes, or choose a new cover image." : "Capture the useful part while it is still fresh.";
  $("#cover-help").textContent = book?.coverUrl ? "Current cover is preserved unless you choose a replacement." : "Optional · JPEG, PNG, or WebP · maximum 5 MiB";
  $("#book-form").querySelector('[type="submit"]').textContent = book ? "Update summary" : "Save summary";
  if (book) {
    $("#book-title").value = book.title;
    $("#book-author").value = book.author;
    $("#book-genre").value = book.genre;
    $("#book-rating").value = String(book.rating);
    $("#book-color").value = book.color;
    $("#book-idea").value = book.bigIdea;
    $("#book-takeaways").value = book.takeaways.join("\n");
    $("#book-quote").value = book.quote || "";
    $("#book-audience").value = book.audience;
  }
  renderChapterFields(book ? chapterList(book) : []);
  $("#book-dialog").showModal();
  $("#book-title").focus();
}

function openBookForm() { prepareBookForm(); }

function openEditForm() {
  const book = books.find((item) => item.id === activeBookId);
  if (!book) return;
  closeDialog("detail-dialog");
  prepareBookForm(book);
}

function updateAdminState() {
  const active = Boolean(sessionStorage.getItem(ADMIN_SESSION_KEY));
  $("#admin-access .desktop-label").textContent = active ? "Admin active" : "Admin access";
  $("#admin-access .mobile-label").textContent = active ? "Admin ✓" : "Admin";
  $("#edit-book").hidden = !active;
  $("#delete-book").hidden = !active;
}

function applyTheme(selected) {
  const theme = THEMES.has(selected) ? selected : "system";
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "midnight" : "matcha") : theme;
  document.documentElement.dataset.theme = resolved;
  $("#theme-select").value = theme;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
}

function exportBooks() {
  const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), books }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shelfnotes-${dateOffset(0)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Persistent library exported with chapter notes.");
}

async function importBookFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const result = await api("/api/books/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
    books = result.books || [];
    activeGenre = "All";
    $("#search").value = "";
    render();
    showToast(`Merged ${result.imported} summaries. Your library now has ${result.total} books.`);
  } catch (error) { showToast(`Import failed: ${error.message}`); }
  finally { $("#import-file").value = ""; }
}

async function uploadCover(book, file) {
  if (!file) return book;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Cover must be JPEG, PNG, or WebP.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Cover image must be 5 MiB or smaller.");
  const result = await api(`/api/books/${encodeURIComponent(book.id)}/cover`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
  return result.book;
}

$("#book-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const isEditing = Boolean(editingBookId);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = isEditing ? "Updating…" : "Saving…";
  const form = new FormData(event.currentTarget);
  const cover = form.get("cover");
  const values = Object.fromEntries(form);
  delete values.cover;
  values.takeaways = String(values.takeaways).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  values.chapters = readChapterFields();
  try {
    const path = isEditing ? `/api/books/${encodeURIComponent(editingBookId)}` : "/api/books";
    const method = isEditing ? "PUT" : "POST";
    let result = await api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    let coverWarning = "";
    if (cover?.size) {
      try { result.book = await uploadCover(result.book, cover); }
      catch (error) { coverWarning = ` The summary was saved, but its cover failed: ${error.message}`; }
    }
    books = [result.book, ...books.filter((book) => book.id !== result.book.id)];
    closeDialog("book-dialog");
    activeGenre = "All";
    $("#search").value = "";
    render();
    showToast(`${isEditing ? "Book summary updated" : "Book summary saved"} in NEO DB.${coverWarning}`);
    if (isEditing) openDetails(result.book.id);
    editingBookId = null;
  } catch (error) { showToast(`${isEditing ? "Update" : "Save"} failed: ${error.message}`); }
  finally {
    submit.disabled = false;
    submit.textContent = editingBookId ? "Update summary" : "Save summary";
  }
});

$("#delete-book").addEventListener("click", async () => {
  const book = books.find((item) => item.id === activeBookId);
  if (!book || !confirm(`Delete “${book.title}” and its stored cover?`)) return;
  try {
    await api(`/api/books/${encodeURIComponent(book.id)}`, { method: "DELETE" });
    books = books.filter((item) => item.id !== book.id);
    closeDialog("detail-dialog");
    activeBookId = null;
    render();
    showToast("Book summary deleted from NEO DB.");
  } catch (error) { showToast(`Delete failed: ${error.message}`); }
});

$("#search").addEventListener("input", render);
$("#open-add").addEventListener("click", openBookForm);
$("#empty-add").addEventListener("click", openBookForm);
$("#edit-book").addEventListener("click", openEditForm);
$("#add-chapter").addEventListener("click", () => addChapterField());
$("#export-books").addEventListener("click", exportBooks);
$("#import-books").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", (event) => importBookFile(event.target.files[0]));
$("#admin-access").addEventListener("click", () => { $("#admin-token").value = ""; $("#admin-dialog").showModal(); $("#admin-token").focus(); });
$("#admin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  sessionStorage.setItem(ADMIN_SESSION_KEY, $("#admin-token").value.trim());
  closeDialog("admin-dialog");
  updateAdminState();
  showToast("Administrator token enabled for this browser tab.");
  loadLibrary();
});
$("#clear-admin").addEventListener("click", () => {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  closeDialog("admin-dialog");
  updateAdminState();
  showToast("Administrator token cleared.");
});
$("#theme-select").addEventListener("change", (event) => { localStorage.setItem(THEME_KEY, event.target.value); applyTheme(event.target.value); });
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.close)));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if ((localStorage.getItem(THEME_KEY) || "system") === "system") applyTheme("system"); });

applyTheme(localStorage.getItem(THEME_KEY) || "system");
updateAdminState();
renderChapterFields();
render();
loadLibrary();
