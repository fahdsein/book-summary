import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
let pool;
let migrated = false;
const memory = new Map();

function useMemory() {
  return process.env.BOOK_STORAGE_MODE === "memory" || (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production");
}

function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("DATABASE_URL is not configured");
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5_000 });
  return pool;
}

async function ensureSchema() {
  if (useMemory() || migrated) return;
  const db = database();
  if (String(process.env.DATABASE_AUTO_MIGRATE).toLowerCase() === "true") {
    await db.query(`
      CREATE TABLE IF NOT EXISTS book_summaries (
        id TEXT PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        author VARCHAR(80) NOT NULL,
        genre VARCHAR(40) NOT NULL,
        rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        finished_at DATE NOT NULL,
        color VARCHAR(20) NOT NULL,
        big_idea VARCHAR(600) NOT NULL,
        takeaways JSONB NOT NULL DEFAULT '[]'::jsonb,
        chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
        quote VARCHAR(300) NOT NULL DEFAULT '',
        audience VARCHAR(300) NOT NULL,
        cover_key TEXT NOT NULL DEFAULT '',
        cover_content_type VARCHAR(80) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query("ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS chapters JSONB NOT NULL DEFAULT '[]'::jsonb");
  }
  migrated = true;
}

function fromRow(row) {
  return {
    id: row.id, title: row.title, author: row.author, genre: row.genre, rating: Number(row.rating),
    finishedAt: typeof row.finished_at === "string" ? row.finished_at.slice(0, 10) : row.finished_at.toISOString().slice(0, 10),
    color: row.color, bigIdea: row.big_idea,
    takeaways: Array.isArray(row.takeaways) ? row.takeaways : [],
    chapters: Array.isArray(row.chapters) ? row.chapters : [],
    quote: row.quote || "", audience: row.audience,
    coverKey: row.cover_key || "", coverContentType: row.cover_content_type || "",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function memoryBook(book) {
  const now = new Date().toISOString();
  const existing = memory.get(book.id);
  return { ...book, coverKey: existing?.coverKey || "", coverContentType: existing?.coverContentType || "", createdAt: existing?.createdAt || now, updatedAt: now };
}

export async function listBooks() {
  await ensureSchema();
  if (useMemory()) return [...memory.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (await database().query("SELECT * FROM book_summaries ORDER BY created_at DESC, title ASC")).rows.map(fromRow);
}

export async function getBook(id) {
  await ensureSchema();
  if (useMemory()) return memory.get(id) || null;
  const result = await database().query("SELECT * FROM book_summaries WHERE id=$1", [id]);
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function saveBook(book) {
  await ensureSchema();
  const value = { ...book, id: book.id || randomUUID() };
  if (useMemory()) {
    const stored = memoryBook(value);
    memory.set(stored.id, stored);
    return stored;
  }
  const values = [value.id,value.title,value.author,value.genre,value.rating,value.finishedAt,value.color,value.bigIdea,JSON.stringify(value.takeaways),JSON.stringify(value.chapters),value.quote,value.audience];
  const result = await database().query(`
    INSERT INTO book_summaries (id,title,author,genre,rating,finished_at,color,big_idea,takeaways,chapters,quote,audience)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
    ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,genre=EXCLUDED.genre,rating=EXCLUDED.rating,finished_at=EXCLUDED.finished_at,color=EXCLUDED.color,big_idea=EXCLUDED.big_idea,takeaways=EXCLUDED.takeaways,chapters=EXCLUDED.chapters,quote=EXCLUDED.quote,audience=EXCLUDED.audience,updated_at=NOW()
    RETURNING *
  `, values);
  return fromRow(result.rows[0]);
}

export async function importBooks(books) {
  await ensureSchema();
  if (useMemory()) {
    for (const book of books) await saveBook({ ...book, id: book.id || randomUUID() });
    return listBooks();
  }
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    for (const book of books) {
      const value = { ...book, id: book.id || randomUUID() };
      await client.query(`
        INSERT INTO book_summaries (id,title,author,genre,rating,finished_at,color,big_idea,takeaways,chapters,quote,audience)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,genre=EXCLUDED.genre,rating=EXCLUDED.rating,finished_at=EXCLUDED.finished_at,color=EXCLUDED.color,big_idea=EXCLUDED.big_idea,takeaways=EXCLUDED.takeaways,chapters=EXCLUDED.chapters,quote=EXCLUDED.quote,audience=EXCLUDED.audience,updated_at=NOW()
      `, [value.id,value.title,value.author,value.genre,value.rating,value.finishedAt,value.color,value.bigIdea,JSON.stringify(value.takeaways),JSON.stringify(value.chapters),value.quote,value.audience]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return listBooks();
}

export async function setBookCover(id, coverKey, coverContentType) {
  await ensureSchema();
  if (useMemory()) {
    const book = memory.get(id);
    if (!book) return null;
    const updated = { ...book, coverKey, coverContentType, updatedAt: new Date().toISOString() };
    memory.set(id, updated);
    return updated;
  }
  const result = await database().query("UPDATE book_summaries SET cover_key=$2,cover_content_type=$3,updated_at=NOW() WHERE id=$1 RETURNING *", [id,coverKey,coverContentType]);
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function removeBook(id) {
  await ensureSchema();
  if (useMemory()) return memory.delete(id);
  return (await database().query("DELETE FROM book_summaries WHERE id=$1", [id])).rowCount > 0;
}

export async function databaseReady() {
  await ensureSchema();
  if (useMemory()) return { ready: true, mode: "memory" };
  await database().query("SELECT 1");
  return { ready: true, mode: "postgres" };
}

export async function closeDatabase() {
  if (pool) await pool.end();
  pool = undefined;
}
