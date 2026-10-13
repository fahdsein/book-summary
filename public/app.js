const THEME_KEY = "shelfnotes.theme.v1";
const THEMES = new Set(["system", "vintage", "midnight", "matcha", "terracotta", "nordic", "lavender", "anthropologist", "autumn", "monolith", "seaside"]);
const $ = (selector) => document.querySelector(selector);
let books = [];
let activeTag = "All";

async function api(path) {
  const response = await fetch(path);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed with HTTP ${response.status}`);
  return payload;
}

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tagsFor(book) { return Array.isArray(book.tags) && book.tags.length ? book.tags : [book.genre].filter(Boolean); }
function chaptersFor(book) { return Array.isArray(book.chapters) ? book.chapters : []; }
function ratingText(rating) { return "★".repeat(rating) + "☆".repeat(5 - rating); }

function displayDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { day:"numeric", month:"short", year:"numeric" }).format(date);
}

function tagList(tags, className = "tag-list") {
  const list = create("div", className);
  list.append(...tags.map((tag) => create("span", "tag", tag)));
  return list;
}

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
  cover.append(tagList(tagsFor(book).slice(0, 3), "tag-list tag-list--cover"));
  const titleGroup = create("div", "book-title-group");
  titleGroup.append(create("h3", "", book.title), create("p", "", `by ${book.author}`));
  cover.append(titleGroup);
  const note = create("div", "book-note");
  note.append(create("p", "", book.bigIdea));
  const meta = create("div", "book-meta");
  const stars = create("span", "stars", ratingText(book.rating));
  stars.setAttribute("aria-label", `${book.rating} out of 5 stars`);
  const chapterCount = chaptersFor(book).length;
  meta.append(stars, create("span", "", chapterCount ? `${chapterCount} ch · ${displayDate(book.finishedAt)}` : displayDate(book.finishedAt)));
  note.append(meta);
  button.append(cover, note);
  article.append(button);
  return article;
}

function visibleBooks() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  return books.filter((book) => {
    const tags = tagsFor(book);
    const matchesTag = activeTag === "All" || tags.some((tag) => tag.toLocaleLowerCase() === activeTag.toLocaleLowerCase());
    const chapterText = chaptersFor(book).flatMap((chapter) => [chapter.title, chapter.summary, ...(chapter.takeaways || [])]);
    const searchable = [book.title, book.author, ...tags, book.bigIdea, book.audience, ...(book.takeaways || []), ...chapterText].join(" ").toLocaleLowerCase();
    return matchesTag && (!query || searchable.includes(query));
  });
}

function renderFilters() {
  const tags = ["All", ...new Set(books.flatMap(tagsFor).sort((a, b) => a.localeCompare(b)))];
  if (!tags.includes(activeTag)) activeTag = "All";
  $("#tag-filters").replaceChildren(...tags.map((tag) => {
    const button = create("button", `filter${tag === activeTag ? " active" : ""}`, tag === "All" ? "All books" : tag);
    button.type = "button";
    button.setAttribute("aria-pressed", String(tag === activeTag));
    button.addEventListener("click", () => { activeTag = tag; render(); });
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

function render() {
  renderFilters();
  $("#stat-books").textContent = books.length;
  $("#stat-streak").textContent = readingStreak();
  const counts = new Map();
  books.flatMap(tagsFor).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  $("#stat-tag").textContent = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "—";
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
  const cover = $("#detail-cover");
  cover.className = `detail-cover cover--${book.color}${book.coverUrl ? " has-image" : ""}`;
  cover.style.backgroundImage = book.coverUrl ? `url("${book.coverUrl}")` : "";
  $("#detail-tags").replaceChildren(...tagsFor(book).map((tag) => create("span", "tag", tag)));
  $("#detail-date").textContent = `Finished ${displayDate(book.finishedAt)}`;
  $("#detail-title").textContent = book.title;
  $("#detail-author").textContent = `by ${book.author}`;
  $("#detail-rating").textContent = ratingText(book.rating);
  $("#detail-rating").setAttribute("aria-label", `${book.rating} out of 5 stars`);
  $("#detail-idea").textContent = book.bigIdea;
  $("#detail-takeaways").replaceChildren(...(book.takeaways || []).map((value) => create("li", "", value)));
  const chapters = chaptersFor(book);
  $("#detail-chapters-section").hidden = chapters.length === 0;
  $("#detail-chapter-count").textContent = `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}`;
  $("#detail-chapters").replaceChildren(...chapters.map(chapterNote));
  $("#detail-quote").textContent = book.quote ? `“${book.quote}”` : "No memorable line was recorded.";
  $("#detail-audience").textContent = book.audience;
  $("#detail-dialog").showModal();
}

function applyTheme(selected) {
  const theme = THEMES.has(selected) ? selected : "system";
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "midnight" : "matcha") : theme;
  document.documentElement.dataset.theme = resolved;
  $("#theme-select").value = theme;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
}

async function load() {
  try {
    const [library, meta] = await Promise.all([api("/api/books"), api("/api/meta")]);
    books = library.books || [];
    $("#app-version").textContent = `v${meta.version}${meta.revision ? ` · ${meta.revision.slice(0, 8)}` : ""}`;
  } catch (error) {
    $("#service-notice").textContent = `The library is temporarily unavailable: ${error.message}`;
    $("#service-notice").hidden = false;
  }
  render();
}

$("#search").addEventListener("input", render);
$("#theme-select").addEventListener("change", (event) => { localStorage.setItem(THEME_KEY, event.target.value); applyTheme(event.target.value); });
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close)?.close()));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if ((localStorage.getItem(THEME_KEY) || "system") === "system") applyTheme("system"); });

applyTheme(localStorage.getItem(THEME_KEY) || "system");
render();
load();
