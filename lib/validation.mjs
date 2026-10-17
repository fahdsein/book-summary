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

function normalizeCollections(value) {
  const source = Array.isArray(value.collections)
    ? value.collections
    : String(value.collections || "").split(/[,;\n]/);
  const collections = [];
  const seen = new Set();
  for (const item of source) {
    const collection = String(item || "").trim().slice(0, 60);
    const key = collection.toLocaleLowerCase();
    if (collection && !seen.has(key)) {
      collections.push(collection);
      seen.add(key);
    }
    if (collections.length === 12) break;
  }
  return collections;
}

function optionalInteger(value, name, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const result = Number.parseInt(value, 10);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    const error = new Error(`${name} must be between ${minimum} and ${maximum}`);
    error.status = 400;
    throw error;
  }
  return result;
}

export function validateEdition(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Edition details must be a JSON object");
    error.status = 400;
    throw error;
  }
  const isbn10 = String(value.isbn10 || "").replace(/[\s-]/g, "").toUpperCase();
  const isbn13 = String(value.isbn13 || "").replace(/[\s-]/g, "");
  if (isbn10 && !/^\d{9}[\dX]$/.test(isbn10)) {
    const error = new Error("ISBN-10 must contain 10 valid characters");
    error.status = 400;
    throw error;
  }
  if (isbn13 && !/^\d{13}$/.test(isbn13)) {
    const error = new Error("ISBN-13 must contain 13 digits");
    error.status = 400;
    throw error;
  }
  const formats = new Set(["", "Hardcover", "Paperback", "Ebook", "Audiobook", "Other"]);
  const format = text(value.format, "Format", 30, false);
  if (!formats.has(format)) {
    const error = new Error("Format must be Hardcover, Paperback, Ebook, Audiobook, or Other");
    error.status = 400;
    throw error;
  }
  return {
    editionLabel:text(value.editionLabel ?? value.edition_label, "Edition label", 100),
    isbn10,
    isbn13,
    publisher:text(value.publisher, "Publisher", 120, false),
    publicationYear:optionalInteger(value.publicationYear ?? value.publication_year, "Publication year", 1000, 2200),
    language:text(value.language, "Language", 60, false),
    format,
    pageCount:optionalInteger(value.pageCount ?? value.page_count, "Page count", 1, 100000)
  };
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
    collections: normalizeCollections(value),
    favorite: value.favorite === true || value.favorite === "true" || value.favorite === "on" || value.favorite === 1,
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
  const books = Array.isArray(value) ? value : Array.isArray(value?.books) ? value.books : value && typeof value === "object" ? [value] : null;
  if (!Array.isArray(books) || !books.length || books.length > 500) {
    const error = new Error("Import must contain one book or an array of at most 500 books");
    error.status = 400;
    throw error;
  }
  return books.map((book) => validateBook(book));
}

const THEME_TOKENS = ["bg","surface","surface2","ink","muted","accent","accent2","line","danger","coverInk","themeColor"];
const CSS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+(?:\s*,\s*[\d.]+\s*)?\)|hsla?\([^)]{1,80}\))$/i;

export function validateTheme(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { const error=new Error("Theme JSON must be an object");error.status=400;throw error; }
  const id=String(value.id||"").trim().toLowerCase();
  if(!/^[a-z][a-z0-9-]{1,39}$/.test(id)){const error=new Error("Theme id must be 2–40 lowercase letters, numbers, or hyphens");error.status=400;throw error;}
  const name=text(value.name,"Theme name",60);
  const source=value.tokens&&typeof value.tokens==="object"&&!Array.isArray(value.tokens)?value.tokens:{};
  const tokens={};
  for(const key of THEME_TOKENS){const color=String(source[key]||"").trim();if(!CSS_COLOR.test(color)){const error=new Error(`Theme token ${key} must be a hex, rgb, rgba, hsl, or hsla color`);error.status=400;throw error;}tokens[key]=color;}
  return{id,name,tokens};
}

export function validateThemeImport(value) {
  const themes=Array.isArray(value)?value:Array.isArray(value?.themes)?value.themes:value&&typeof value==="object"?[value]:null;
  if(!Array.isArray(themes)||!themes.length||themes.length>100){const error=new Error("Import must contain one theme or an array of at most 100 themes");error.status=400;throw error;}
  return themes.map(validateTheme);
}
