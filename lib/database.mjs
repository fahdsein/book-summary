import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const MAX_COVERS = 8;
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
  pool ||= new Pool({ connectionString:process.env.DATABASE_URL, max:8, connectionTimeoutMillis:5_000 });
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
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        collections JSONB NOT NULL DEFAULT '[]'::jsonb,
        favorite BOOLEAN NOT NULL DEFAULT FALSE,
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
        pdf_url TEXT NOT NULL DEFAULT '',
        pdf_key TEXT NOT NULL DEFAULT '',
        pdf_name VARCHAR(180) NOT NULL DEFAULT '',
        pdf_content_type VARCHAR(80) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS chapters JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS collections JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS pdf_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS pdf_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS pdf_name VARCHAR(180) NOT NULL DEFAULT '';
      ALTER TABLE book_summaries ADD COLUMN IF NOT EXISTS pdf_content_type VARCHAR(80) NOT NULL DEFAULT '';
      CREATE TABLE IF NOT EXISTS book_covers (
        cover_id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES book_summaries(id) ON DELETE CASCADE,
        edition_label VARCHAR(100) NOT NULL,
        position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 8),
        object_key TEXT NOT NULL UNIQUE,
        content_type VARCHAR(80) NOT NULL,
        isbn_10 VARCHAR(10) NOT NULL DEFAULT '',
        isbn_13 VARCHAR(13) NOT NULL DEFAULT '',
        publisher VARCHAR(120) NOT NULL DEFAULT '',
        publication_year SMALLINT,
        language VARCHAR(60) NOT NULL DEFAULT '',
        format VARCHAR(30) NOT NULL DEFAULT '',
        page_count INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (book_id, position)
      );
      CREATE INDEX IF NOT EXISTS book_covers_book_idx ON book_covers(book_id, position);
      ALTER TABLE book_covers ADD COLUMN IF NOT EXISTS isbn_10 VARCHAR(10) NOT NULL DEFAULT '';
      ALTER TABLE book_covers ADD COLUMN IF NOT EXISTS isbn_13 VARCHAR(13) NOT NULL DEFAULT '';
      ALTER TABLE book_covers ADD COLUMN IF NOT EXISTS publisher VARCHAR(120) NOT NULL DEFAULT '';
      ALTER TABLE book_covers ADD COLUMN IF NOT EXISTS publication_year SMALLINT;
      ALTER TABLE book_covers ADD COLUMN IF NOT EXISTS language VARCHAR(60) NOT NULL DEFAULT '';
      ALTER TABLE book_covers ADD COLUMN IF NOT EXISTS format VARCHAR(30) NOT NULL DEFAULT '';
      ALTER TABLE book_covers ADD COLUMN IF NOT EXISTS page_count INTEGER;
      UPDATE book_summaries SET tags=jsonb_build_array(genre) WHERE tags='[]'::jsonb AND genre<>'';
      INSERT INTO book_covers (cover_id,book_id,edition_label,position,object_key,content_type)
      SELECT 'legacy-' || id,id,'Default edition',1,cover_key,cover_content_type
      FROM book_summaries WHERE cover_key<>''
      ON CONFLICT DO NOTHING;
    `);
  }
  migrated = true;
}

function coverFromRow(row) {
  return {
    coverId:row.cover_id, bookId:row.book_id, editionLabel:row.edition_label, position:Number(row.position), objectKey:row.object_key, contentType:row.content_type,
    isbn10:row.isbn_10 || "", isbn13:row.isbn_13 || "", publisher:row.publisher || "",
    publicationYear:row.publication_year === null || row.publication_year === undefined ? null : Number(row.publication_year),
    language:row.language || "", format:row.format || "",
    pageCount:row.page_count === null || row.page_count === undefined ? null : Number(row.page_count),
    createdAt:row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

export function legacyCoverFromRow(row) {
  if (!row?.cover_key) return null;
  return {
    coverId:`legacy-${row.id}`,
    bookId:row.id,
    editionLabel:"Default edition",
    position:1,
    objectKey:row.cover_key,
    contentType:row.cover_content_type || "application/octet-stream",
    isbn10:"", isbn13:"", publisher:"", publicationYear:null, language:"", format:"", pageCount:null,
    createdAt:row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function fromRow(row, covers = []) {
  const legacyCover = legacyCoverFromRow(row);
  return {
    id:row.id, title:row.title, author:row.author, genre:row.genre,
    tags:Array.isArray(row.tags) && row.tags.length ? row.tags : [row.genre].filter(Boolean),
    collections:Array.isArray(row.collections) ? row.collections : [],
    favorite:Boolean(row.favorite),
    rating:Number(row.rating),
    finishedAt:typeof row.finished_at === "string" ? row.finished_at.slice(0,10) : row.finished_at.toISOString().slice(0,10),
    color:row.color, bigIdea:row.big_idea,
    takeaways:Array.isArray(row.takeaways) ? row.takeaways : [],
    chapters:Array.isArray(row.chapters) ? row.chapters : [],
    quote:row.quote || "", audience:row.audience,
    // Version 3 stored one cover directly on book_summaries. Keep serving it
    // when the idempotent v4 backfill has not run yet, so a deploy cannot make
    // an existing S3 object appear to vanish from the library.
    covers:covers.length ? covers : [legacyCover].filter(Boolean),
    pdfUrl:row.pdf_url || "", pdfKey:row.pdf_key || "", pdfName:row.pdf_name || "", pdfContentType:row.pdf_content_type || "",
    createdAt:row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt:row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

async function coversByBook(bookId = "") {
  if (useMemory()) return new Map([[bookId, memory.get(bookId)?.covers || []]]);
  const result = bookId
    ? await database().query("SELECT * FROM book_covers WHERE book_id=$1 ORDER BY position", [bookId])
    : await database().query("SELECT * FROM book_covers ORDER BY book_id,position");
  const grouped = new Map();
  for (const row of result.rows) {
    const cover = coverFromRow(row);
    grouped.set(cover.bookId, [...(grouped.get(cover.bookId) || []), cover]);
  }
  return grouped;
}

function memoryBook(book) {
  const now = new Date().toISOString();
  const existing = memory.get(book.id);
  return {
    ...book,
    covers:existing?.covers || [],
    pdfKey:existing?.pdfKey || "", pdfName:existing?.pdfName || "", pdfContentType:existing?.pdfContentType || "",
    createdAt:existing?.createdAt || now, updatedAt:now
  };
}

export async function listBooks() {
  await ensureSchema();
  if (useMemory()) return [...memory.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const [books, coverMap] = await Promise.all([database().query("SELECT * FROM book_summaries ORDER BY created_at DESC,title ASC"), coversByBook()]);
  return books.rows.map((row) => fromRow(row, coverMap.get(row.id) || []));
}

export async function getBook(id) {
  await ensureSchema();
  if (useMemory()) return memory.get(id) || null;
  const [result, coverMap] = await Promise.all([database().query("SELECT * FROM book_summaries WHERE id=$1", [id]), coversByBook(id)]);
  return result.rows[0] ? fromRow(result.rows[0], coverMap.get(id) || []) : null;
}

export async function saveBook(book) {
  await ensureSchema();
  const value = { ...book, id:book.id || randomUUID(), pdfUrl:book.pdfUrl || "" };
  if (useMemory()) {
    const stored = memoryBook(value);
    memory.set(stored.id, stored);
    return stored;
  }
  const values = [value.id,value.title,value.author,value.genre,JSON.stringify(value.tags),JSON.stringify(value.collections||[]),Boolean(value.favorite),value.rating,value.finishedAt,value.color,value.bigIdea,JSON.stringify(value.takeaways),JSON.stringify(value.chapters),value.quote,value.audience,value.pdfUrl];
  const result = await database().query(`
    INSERT INTO book_summaries (id,title,author,genre,tags,collections,favorite,rating,finished_at,color,big_idea,takeaways,chapters,quote,audience,pdf_url)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16)
    ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,genre=EXCLUDED.genre,tags=EXCLUDED.tags,collections=EXCLUDED.collections,favorite=EXCLUDED.favorite,rating=EXCLUDED.rating,finished_at=EXCLUDED.finished_at,color=EXCLUDED.color,big_idea=EXCLUDED.big_idea,takeaways=EXCLUDED.takeaways,chapters=EXCLUDED.chapters,quote=EXCLUDED.quote,audience=EXCLUDED.audience,pdf_url=EXCLUDED.pdf_url,updated_at=NOW()
    RETURNING *
  `, values);
  return getBook(result.rows[0].id);
}

export async function importBooks(books) {
  await ensureSchema();
  if (useMemory()) {
    for (const book of books) {
      const existing = book.id ? memory.get(book.id) : null;
      await saveBook({ ...book, id:book.id || randomUUID(), pdfUrl:existing ? existing.pdfUrl : (book.pdfUrl || "") });
    }
    return listBooks();
  }
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    for (const book of books) {
      const value = { ...book, id:book.id || randomUUID() };
      await client.query(`
        INSERT INTO book_summaries (id,title,author,genre,tags,collections,favorite,rating,finished_at,color,big_idea,takeaways,chapters,quote,audience,pdf_url)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16)
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,genre=EXCLUDED.genre,tags=EXCLUDED.tags,collections=EXCLUDED.collections,favorite=EXCLUDED.favorite,rating=EXCLUDED.rating,finished_at=EXCLUDED.finished_at,color=EXCLUDED.color,big_idea=EXCLUDED.big_idea,takeaways=EXCLUDED.takeaways,chapters=EXCLUDED.chapters,quote=EXCLUDED.quote,audience=EXCLUDED.audience,updated_at=NOW()
      `,[value.id,value.title,value.author,value.genre,JSON.stringify(value.tags),JSON.stringify(value.collections||[]),Boolean(value.favorite),value.rating,value.finishedAt,value.color,value.bigIdea,JSON.stringify(value.takeaways),JSON.stringify(value.chapters),value.quote,value.audience,value.pdfUrl||""]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  return listBooks();
}

export async function addBookCover(bookId, objectKey, contentType, editionLabel) {
  await ensureSchema();
  const coverId = randomUUID();
  if (useMemory()) {
    const book = memory.get(bookId);
    if (!book) return null;
    if (book.covers.length >= MAX_COVERS) { const error = new Error(`A book can contain at most ${MAX_COVERS} edition covers`); error.status=400; throw error; }
    const cover = { coverId,bookId,editionLabel,position:book.covers.length+1,objectKey,contentType,isbn10:"",isbn13:"",publisher:"",publicationYear:null,language:"",format:"",pageCount:null,createdAt:new Date().toISOString() };
    memory.set(bookId,{ ...book,covers:[...book.covers,cover],updatedAt:new Date().toISOString() });
    return cover;
  }
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT id FROM book_summaries WHERE id=$1 FOR UPDATE",[bookId]);
    if (!locked.rowCount) { await client.query("ROLLBACK"); return null; }
    const count = Number((await client.query("SELECT COUNT(*)::int AS count FROM book_covers WHERE book_id=$1",[bookId])).rows[0].count);
    if (count >= MAX_COVERS) { const error = new Error(`A book can contain at most ${MAX_COVERS} edition covers`); error.status=400; throw error; }
    const result = await client.query("INSERT INTO book_covers (cover_id,book_id,edition_label,position,object_key,content_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",[coverId,bookId,editionLabel,count+1,objectKey,contentType]);
    await client.query("UPDATE book_summaries SET updated_at=NOW() WHERE id=$1",[bookId]);
    await client.query("COMMIT");
    return coverFromRow(result.rows[0]);
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function getCover(coverId) {
  await ensureSchema();
  if (useMemory()) {
    for (const book of memory.values()) { const cover=book.covers.find((item)=>item.coverId===coverId); if (cover) return cover; }
    return null;
  }
  const result=await database().query("SELECT * FROM book_covers WHERE cover_id=$1",[coverId]);
  if(result.rows[0])return coverFromRow(result.rows[0]);
  if(coverId.startsWith("legacy-")){
    const legacy=await database().query("SELECT id,cover_key,cover_content_type,created_at FROM book_summaries WHERE id=$1 AND cover_key<>''",[coverId.slice(7)]);
    return legacy.rows[0] ? legacyCoverFromRow(legacy.rows[0]) : null;
  }
  return null;
}

export async function updateBookEdition(bookId, coverId, edition) {
  await ensureSchema();
  if (useMemory()) {
    const book=memory.get(bookId);if(!book)return null;
    const selected=book.covers.find((item)=>item.coverId===coverId);if(!selected)return null;
    const updated={...selected,...edition};
    memory.set(bookId,{...book,covers:book.covers.map((item)=>item.coverId===coverId?updated:item),updatedAt:new Date().toISOString()});
    return updated;
  }
  const result=await database().query(`
    UPDATE book_covers SET edition_label=$3,isbn_10=$4,isbn_13=$5,publisher=$6,publication_year=$7,language=$8,format=$9,page_count=$10
    WHERE cover_id=$1 AND book_id=$2 RETURNING *
  `,[coverId,bookId,edition.editionLabel,edition.isbn10,edition.isbn13,edition.publisher,edition.publicationYear,edition.language,edition.format,edition.pageCount]);
  if(!result.rowCount)return null;
  await database().query("UPDATE book_summaries SET updated_at=NOW() WHERE id=$1",[bookId]);
  return coverFromRow(result.rows[0]);
}

export async function removeBookCover(coverId) {
  await ensureSchema();
  if (useMemory()) {
    for (const [id,book] of memory) {
      const removed=book.covers.find((item)=>item.coverId===coverId);
      if (removed) { memory.set(id,{...book,covers:book.covers.filter((item)=>item.coverId!==coverId).map((item,index)=>({...item,position:index+1})),updatedAt:new Date().toISOString()}); return removed; }
    }
    return null;
  }
  const client=await database().connect();
  try {
    await client.query("BEGIN");
    const result=await client.query("DELETE FROM book_covers WHERE cover_id=$1 RETURNING *",[coverId]);
    const removed=result.rows[0] ? coverFromRow(result.rows[0]) : null;
    if (removed) {
      const remaining=(await client.query("SELECT * FROM book_covers WHERE book_id=$1 ORDER BY position",[removed.bookId])).rows;
      await client.query("DELETE FROM book_covers WHERE book_id=$1",[removed.bookId]);
      for(let index=0;index<remaining.length;index+=1){const row=remaining[index];await client.query("INSERT INTO book_covers (cover_id,book_id,edition_label,position,object_key,content_type,isbn_10,isbn_13,publisher,publication_year,language,format,page_count,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[row.cover_id,row.book_id,row.edition_label,index+1,row.object_key,row.content_type,row.isbn_10||"",row.isbn_13||"",row.publisher||"",row.publication_year??null,row.language||"",row.format||"",row.page_count??null,row.created_at]);}
      await client.query("UPDATE book_summaries SET updated_at=NOW() WHERE id=$1",[removed.bookId]);
    }
    await client.query("COMMIT"); return removed;
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function setPrimaryCover(bookId, coverId) {
  await ensureSchema();
  if (useMemory()) {
    const book=memory.get(bookId); if(!book)return null;
    const selected=book.covers.find((item)=>item.coverId===coverId); if(!selected)return null;
    const covers=[selected,...book.covers.filter((item)=>item.coverId!==coverId)].map((item,index)=>({...item,position:index+1}));
    memory.set(bookId,{...book,covers,updatedAt:new Date().toISOString()}); return covers[0];
  }
  const client=await database().connect();
  try {
    await client.query("BEGIN");
    const selected=(await client.query("SELECT * FROM book_covers WHERE cover_id=$1 AND book_id=$2 FOR UPDATE",[coverId,bookId])).rows[0];
    if(!selected){await client.query("ROLLBACK");return null;}
    if(Number(selected.position)!==1){
      await client.query("DELETE FROM book_covers WHERE cover_id=$1",[coverId]);
      await client.query("UPDATE book_covers SET position=$2 WHERE book_id=$1 AND position=1",[bookId,selected.position]);
      await client.query("INSERT INTO book_covers (cover_id,book_id,edition_label,position,object_key,content_type,isbn_10,isbn_13,publisher,publication_year,language,format,page_count,created_at) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[selected.cover_id,selected.book_id,selected.edition_label,selected.object_key,selected.content_type,selected.isbn_10||"",selected.isbn_13||"",selected.publisher||"",selected.publication_year??null,selected.language||"",selected.format||"",selected.page_count??null,selected.created_at]);
    }
    await client.query("UPDATE book_summaries SET updated_at=NOW() WHERE id=$1",[bookId]);
    await client.query("COMMIT");return coverFromRow({...selected,position:1});
  } catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function setBookPdfFile(id,key,name,contentType) {
  await ensureSchema();
  if(useMemory()){const book=memory.get(id);if(!book)return null;const updated={...book,pdfUrl:"",pdfKey:key,pdfName:name,pdfContentType:contentType,updatedAt:new Date().toISOString()};memory.set(id,updated);return updated;}
  await database().query("UPDATE book_summaries SET pdf_url='',pdf_key=$2,pdf_name=$3,pdf_content_type=$4,updated_at=NOW() WHERE id=$1",[id,key,name,contentType]);
  return getBook(id);
}

export async function clearBookPdfFile(id) {
  await ensureSchema();
  if(useMemory()){const book=memory.get(id);if(!book)return null;const updated={...book,pdfKey:"",pdfName:"",pdfContentType:"",updatedAt:new Date().toISOString()};memory.set(id,updated);return updated;}
  await database().query("UPDATE book_summaries SET pdf_key='',pdf_name='',pdf_content_type='',updated_at=NOW() WHERE id=$1",[id]);
  return getBook(id);
}

export async function clearBookPdf(id) {
  await ensureSchema();
  if(useMemory()){const book=memory.get(id);if(!book)return null;const updated={...book,pdfUrl:"",pdfKey:"",pdfName:"",pdfContentType:"",updatedAt:new Date().toISOString()};memory.set(id,updated);return updated;}
  await database().query("UPDATE book_summaries SET pdf_url='',pdf_key='',pdf_name='',pdf_content_type='',updated_at=NOW() WHERE id=$1",[id]);
  return getBook(id);
}

export async function removeBook(id) {
  await ensureSchema();
  const existing=await getBook(id);if(!existing)return{removed:false,covers:[],pdfKey:""};
  if(useMemory()){memory.delete(id);return{removed:true,covers:existing.covers,pdfKey:existing.pdfKey};}
  const result=await database().query("DELETE FROM book_summaries WHERE id=$1",[id]);
  return{removed:result.rowCount>0,covers:existing.covers,pdfKey:existing.pdfKey};
}

export async function databaseReady(){await ensureSchema();if(useMemory())return{ready:true,mode:"memory"};await database().query("SELECT 1");return{ready:true,mode:"postgres"};}
export async function closeDatabase(){if(pool)await pool.end();pool=undefined;}
export { MAX_COVERS };
