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

function normalizeTags(value) {
  const source = Array.isArray(value.tags)
    ? value.tags
    : String(value.tags || value.genres || value.genre || "").split(/[,;\n]/);
  const tags = [];
  const seen = new Set();
  for (const item of source) {
    const tag = String(item || "").trim().slice(0, 40);
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) {
      tags.push(tag);
      seen.add(key);
    }
    if (tags.length === 12) break;
  }
  if (!tags.length) {
    const error = new Error("At least one tag is required");
    error.status = 400;
    throw error;
  }
  return tags;
}

function optionalPdfUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > 2000) { const error = new Error("PDF URL is too long"); error.status=400; throw error; }
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    const error = new Error("PDF URL must be a valid HTTP or HTTPS address without embedded credentials");
    error.status=400;
    throw error;
  }
}

export function validateBook(value, { allowId = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Book must be a JSON object");
    error.status = 400;
    throw error;
  }
  const tags = normalizeTags(value);
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
  const chapterInput = Array.isArray(value.chapters) ? value.chapters : [];
  if (chapterInput.length > 80) {
    const error = new Error("A book can contain at most 80 chapter notes");
    error.status = 400;
    throw error;
  }
  const chapters = chapterInput.map((chapter, index) => {
    if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) {
      const error = new Error(`Chapter ${index + 1} must be an object`);
      error.status = 400;
      throw error;
    }
    const chapterTakeaways = Array.isArray(chapter.takeaways)
      ? chapter.takeaways.map((item) => String(item).trim().slice(0, 300)).filter(Boolean).slice(0, 12)
      : String(chapter.takeaways || "").split(/\r?\n/).map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 12);
    return {
      title: text(chapter.title, `Chapter ${index + 1} title`, 160),
      summary: text(chapter.summary, `Chapter ${index + 1} summary`, 4000),
      takeaways: chapterTakeaways
    };
  });
  return {
    id: allowId ? text(value.id, "ID", 100, false) : "",
    title: text(value.title, "Title", 100),
    author: text(value.author, "Author", 80),
    genre: tags[0],
    tags,
    rating,
    finishedAt: date,
    color: COLORS.has(value.color) ? value.color : "sage",
    bigIdea: text(value.bigIdea ?? value.big_idea, "Big idea", 600),
    takeaways,
    chapters,
    quote: text(value.quote, "Quote", 300, false),
    audience: text(value.audience, "Audience", 300),
    pdfUrl: optionalPdfUrl(value.pdfUrl ?? value.pdf_url)
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
