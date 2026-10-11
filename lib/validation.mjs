const COLORS = new Set(["sage", "amber", "burgundy", "navy", "plum", "teal"]);

function text(value, name, maximum, required = true) {
  const result = String(value || "").trim().slice(0, maximum);
  if (required && !result) {
    const error = new Error(`${name} is required`);
    error.status = 400;
    throw error;
  }
  return result;
}

export function validateBook(value, { allowId = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Book must be a JSON object");
    error.status = 400;
    throw error;
  }
  const takeaways = Array.isArray(value.takeaways)
    ? value.takeaways.map((item) => String(item).trim().slice(0, 300)).filter(Boolean).slice(0, 12)
    : String(value.takeaways || "").split(/\r?\n|,/).map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 12);
  if (!takeaways.length) {
    const error = new Error("At least one takeaway is required");
    error.status = 400;
    throw error;
  }
  const date = String(value.finishedAt || value.finished_at || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    const error = new Error("Finished date must use YYYY-MM-DD");
    error.status = 400;
    throw error;
  }
  const rating = Number.parseInt(value.rating, 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    const error = new Error("Rating must be between 1 and 5");
    error.status = 400;
    throw error;
  }
  return {
    id: allowId ? text(value.id, "ID", 100, false) : "",
    title: text(value.title, "Title", 100),
    author: text(value.author, "Author", 80),
    genre: text(value.genre, "Genre", 40),
    rating,
    finishedAt: date,
    color: COLORS.has(value.color) ? value.color : "sage",
    bigIdea: text(value.bigIdea ?? value.big_idea, "Big idea", 600),
    takeaways,
    quote: text(value.quote, "Quote", 300, false),
    audience: text(value.audience, "Audience", 300)
  };
}

export function validateImport(value) {
  const books = Array.isArray(value) ? value : value?.books;
  if (!Array.isArray(books) || books.length > 500) {
    const error = new Error("Import must contain an array of at most 500 books");
    error.status = 400;
    throw error;
  }
  return books.map((book) => validateBook(book));
}
