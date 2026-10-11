const STORAGE_KEY = "shelfnotes.books.v1";
const THEME_KEY = "shelfnotes.theme.v1";
const THEMES = new Set(["system", "vintage", "midnight", "matcha", "terracotta", "nordic", "lavender", "anthropologist", "autumn", "monolith", "seaside"]);
const COLORS = new Set(["sage", "amber", "burgundy", "navy", "plum", "teal"]);
const $ = (selector) => document.querySelector(selector);

function dateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const seedBooks = () => [
  {
    id: "seed-atomic-habits", title: "Atomic Habits", author: "James Clear", genre: "Psychology", rating: 5,
    finishedAt: dateOffset(0), color: "sage",
    bigIdea: "Small repeated improvements compound into meaningful change when they are supported by a practical system and a believable identity.",
    takeaways: ["Design the environment so the desired action is obvious.", "Make a good habit easy to begin and satisfying to complete.", "Track the identity your repeated actions are reinforcing."],
    quote: "Every action is evidence for the person you are becoming.",
    audience: "Readers who want a practical framework for building or changing everyday habits."
  },
  {
    id: "seed-deep-work", title: "Deep Work", author: "Cal Newport", genre: "Non-Fiction", rating: 5,
    finishedAt: dateOffset(1), color: "navy",
    bigIdea: "Uninterrupted concentration is a trainable skill that creates unusually valuable work in an increasingly distracted world.",
    takeaways: ["Schedule demanding work instead of waiting for free time.", "Reduce attention residue by grouping shallow tasks.", "Rest and boredom are part of rebuilding concentration."],
    quote: "Clarity about what matters makes it easier to ignore what does not.",
    audience: "Knowledge workers, students, and creators who need longer periods of focused thought."
  },
  {
    id: "seed-thinking", title: "Thinking, Fast and Slow", author: "Daniel Kahneman", genre: "Psychology", rating: 4,
    finishedAt: dateOffset(2), color: "amber",
    bigIdea: "Judgment moves between fast intuition and slower deliberate reasoning, and each mode has predictable strengths and blind spots.",
    takeaways: ["Easy stories can feel more certain than the evidence deserves.", "Losses often influence decisions more strongly than equal gains.", "Pause when a decision contains unfamiliar risk or seductive statistics."],
    quote: "Confidence and accuracy are not the same thing.",
    audience: "Anyone interested in decisions, behavioral economics, and the limits of intuition."
  },
  {
    id: "seed-pragmatic", title: "The Pragmatic Programmer", author: "Andrew Hunt & David Thomas", genre: "Technology", rating: 5,
    finishedAt: dateOffset(3), color: "teal",
    bigIdea: "Software development is a craft strengthened by responsibility, feedback, adaptable design, and continuous learning.",
    takeaways: ["Keep knowledge in one authoritative place.", "Prefer reversible decisions when uncertainty is high.", "Use automation and feedback to protect quality."],
    quote: "Offer options and a plan instead of an excuse.",
    audience: "Developers and technical leads who want durable habits for building maintainable software."
  }
];

let books = loadBooks();
let activeGenre = "All";
let activeBookId = null;
let toastTimer;

function normalizeBook(value) {
  if (!value || typeof value !== "object") throw new Error("Each book must be an object.");
  const text = (field, maximum, required = true) => {
    const result = String(value[field] || "").trim().slice(0, maximum);
    if (required && !result) throw new Error(`Book ${field} is required.`);
    return result;
  };
  const takeaways = Array.isArray(value.takeaways)
    ? value.takeaways.map((item) => String(item).trim().slice(0, 300)).filter(Boolean).slice(0, 12)
    : String(value.takeaways || "").split(/\r?\n|,/).map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 12);
  if (!takeaways.length) throw new Error("Each book needs at least one takeaway.");
  const finishedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(value.finishedAt || "")) ? value.finishedAt : dateOffset(0);
  return {
    id: text("id", 100, false) || (crypto.randomUUID?.() || `book-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    title: text("title", 100), author: text("author", 80), genre: text("genre", 40),
    rating: Math.min(5, Math.max(1, Number.parseInt(value.rating, 10) || 3)),
    finishedAt, color: COLORS.has(value.color) ? value.color : "sage",
    bigIdea: text("bigIdea", 600), takeaways,
    quote: text("quote", 300, false), audience: text("audience", 300)
  };
}

function loadBooks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved)) return saved.map(normalizeBook);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return seedBooks();
}

function saveBooks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
  } catch {
    showToast("Browser storage is unavailable. Export your notes before leaving.");
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
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

function ratingText(rating) {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function bookCard(book) {
  const article = create("article", "book-card");
  const button = create("button", "book-open");
  button.type = "button";
  button.setAttribute("aria-label", `Open summary for ${book.title}`);
  button.addEventListener("click", () => openDetails(book.id));

  const cover = create("div", `book-cover cover--${book.color}`);
  cover.append(create("span", "badge", book.genre));
  const titleGroup = create("div");
  titleGroup.append(create("h3", "", book.title), create("p", "", `by ${book.author}`));
  cover.append(titleGroup);

  const note = create("div", "book-note");
  note.append(create("p", "", book.bigIdea));
  const meta = create("div", "book-meta");
  const stars = create("span", "stars", ratingText(book.rating));
  stars.setAttribute("aria-label", `${book.rating} out of 5 stars`);
  meta.append(stars, create("span", "", displayDate(book.finishedAt)));
  note.append(meta);
  button.append(cover, note);
  article.append(button);
  return article;
}

function visibleBooks() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  return books.filter((book) => {
    const genreMatches = activeGenre === "All" || book.genre === activeGenre;
    const searchable = [book.title, book.author, book.genre, book.bigIdea, book.audience, ...book.takeaways].join(" ").toLocaleLowerCase();
    return genreMatches && (!query || searchable.includes(query));
  });
}

function renderFilters() {
  const genres = ["All", ...new Set(books.map((book) => book.genre).sort((a, b) => a.localeCompare(b)))];
  if (!genres.includes(activeGenre)) activeGenre = "All";
  const root = $("#genre-filters");
  root.replaceChildren(...genres.map((genre) => {
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
    const difference = Math.round((previous - current) / 86_400_000);
    if (difference !== 1) break;
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
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  $("#stat-genre").textContent = top?.[0] || "—";
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

function openDetails(id) {
  const book = books.find((item) => item.id === id);
  if (!book) return;
  activeBookId = id;
  $("#detail-cover").className = `detail-cover cover--${book.color}`;
  $("#detail-genre").textContent = book.genre;
  $("#detail-date").textContent = `Finished ${displayDate(book.finishedAt)}`;
  $("#detail-title").textContent = book.title;
  $("#detail-author").textContent = `by ${book.author}`;
  $("#detail-rating").textContent = ratingText(book.rating);
  $("#detail-rating").setAttribute("aria-label", `${book.rating} out of 5 stars`);
  $("#detail-idea").textContent = book.bigIdea;
  $("#detail-takeaways").replaceChildren(...book.takeaways.map((value) => create("li", "", value)));
  $("#detail-quote").textContent = book.quote ? `“${book.quote}”` : "No memorable line was recorded.";
  $("#detail-audience").textContent = book.audience;
  $("#detail-dialog").showModal();
}

function openBookForm() {
  $("#book-form").reset();
  $("#book-date").value = dateOffset(0);
  $("#book-dialog").showModal();
  $("#book-title").focus();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function applyTheme(selected) {
  const theme = THEMES.has(selected) ? selected : "system";
  const resolved = theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "midnight" : "matcha")
    : theme;
  document.documentElement.dataset.theme = resolved;
  $("#theme-select").value = theme;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
}

function exportBooks() {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), books }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shelfnotes-${dateOffset(0)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Book summaries exported.");
}

async function importBooks(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const values = Array.isArray(parsed) ? parsed : parsed.books;
    if (!Array.isArray(values) || values.length > 500) throw new Error("The file must contain at most 500 books.");
    const imported = values.map(normalizeBook);
    if (!confirm(`Replace this browser's ${books.length} summaries with ${imported.length} imported summaries?`)) return;
    books = imported;
    saveBooks();
    activeGenre = "All";
    $("#search").value = "";
    render();
    showToast("Book summaries imported.");
  } catch (error) {
    showToast(`Import failed: ${error.message}`);
  } finally {
    $("#import-file").value = "";
  }
}

$("#book-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.id = crypto.randomUUID?.() || `book-${Date.now()}`;
  values.takeaways = String(values.takeaways).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  try {
    books.unshift(normalizeBook(values));
    saveBooks();
    closeDialog("book-dialog");
    activeGenre = "All";
    $("#search").value = "";
    render();
    showToast("Book summary saved in this browser.");
  } catch (error) {
    showToast(error.message);
  }
});

$("#delete-book").addEventListener("click", () => {
  const book = books.find((item) => item.id === activeBookId);
  if (!book || !confirm(`Delete “${book.title}” from this browser?`)) return;
  books = books.filter((item) => item.id !== activeBookId);
  saveBooks();
  closeDialog("detail-dialog");
  activeBookId = null;
  render();
  showToast("Book summary deleted.");
});

$("#search").addEventListener("input", render);
$("#open-add").addEventListener("click", openBookForm);
$("#empty-add").addEventListener("click", openBookForm);
$("#export-books").addEventListener("click", exportBooks);
$("#import-books").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", (event) => importBooks(event.target.files[0]));
$("#theme-select").addEventListener("change", (event) => {
  localStorage.setItem(THEME_KEY, event.target.value);
  applyTheme(event.target.value);
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.close)));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if ((localStorage.getItem(THEME_KEY) || "system") === "system") applyTheme("system");
});

applyTheme(localStorage.getItem(THEME_KEY) || "system");
render();
