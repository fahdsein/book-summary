import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addBookCover,clearBookPdf,clearBookPdfFile,closeDatabase,databaseReady,getActiveTheme,getBook,getCover,importBooks,listBooks,listThemes,removeBook,removeBookCover,removeTheme,saveBook,saveTheme,setActiveTheme,setBookPdfFile,setPrimaryCover,updateBookEdition } from "./lib/database.mjs";
import { deleteObject,readObject,storageReady,uploadCover,uploadPdf,validateCoverType } from "./lib/storage.mjs";
import { validateBook,validateEdition,validateImport,validateThemeImport } from "./lib/validation.mjs";

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR=path.join(ROOT,"public");
const PACKAGE=JSON.parse(readFileSync(path.join(ROOT,"package.json"),"utf8"));
const APP_VERSION=process.env.APP_VERSION||PACKAGE.version;
const BUILD_REVISION=String(process.env.BUILD_REVISION||"").slice(0,40);
const MAX_JSON_BYTES=1024*1024;
const MAX_COVER_BYTES=5*1024*1024;
const configuredPdfBytes=Number(process.env.MAX_PDF_BYTES||25*1024*1024);
const MAX_PDF_BYTES=Number.isFinite(configuredPdfBytes)&&configuredPdfBytes>0?configuredPdfBytes:25*1024*1024;
const TYPES=new Map([[".css","text/css; charset=utf-8"],[".html","text/html; charset=utf-8"],[".ico","image/x-icon"],[".js","text/javascript; charset=utf-8"],[".json","application/json; charset=utf-8"],[".svg","image/svg+xml; charset=utf-8"],[".txt","text/plain; charset=utf-8"],[".woff2","font/woff2"]]);
const SECURITY_HEADERS={"Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'","Referrer-Policy":"strict-origin-when-cross-origin","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY"};

function json(response,status,value){const body=JSON.stringify(value);response.writeHead(status,{...SECURITY_HEADERS,"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(body)});response.end(body);}
async function readBody(request,maximum){if(Number(request.headers["content-length"]||0)>maximum){const error=new Error(`Request body exceeds ${Math.round(maximum/1024/1024)} MiB`);error.status=413;throw error;}const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maximum){const error=new Error(`Request body exceeds ${Math.round(maximum/1024/1024)} MiB`);error.status=413;throw error;}chunks.push(chunk);}return Buffer.concat(chunks);}
async function readJson(request){const raw=await readBody(request,MAX_JSON_BYTES);try{return JSON.parse(raw.toString("utf8")||"{}");}catch{const error=new Error("Request body must be valid JSON");error.status=400;throw error;}}

function publicBook(book){
  const covers=(book.covers||[]).map((cover)=>({coverId:cover.coverId,editionLabel:cover.editionLabel,position:cover.position,isbn10:cover.isbn10||"",isbn13:cover.isbn13||"",publisher:cover.publisher||"",publicationYear:cover.publicationYear??null,language:cover.language||"",format:cover.format||"",pageCount:cover.pageCount??null,url:`/api/covers/${encodeURIComponent(cover.coverId)}`}));
  return {id:book.id,title:book.title,author:book.author,genre:book.genre,tags:book.tags,collections:book.collections||[],favorite:Boolean(book.favorite),rating:book.rating,finishedAt:book.finishedAt,color:book.color,bigIdea:book.bigIdea,takeaways:book.takeaways,chapters:book.chapters,quote:book.quote,audience:book.audience,covers,editions:covers,coverUrl:covers[0]?.url||"",createdAt:book.createdAt,updatedAt:book.updatedAt};
}
function adminBook(book){return{...publicBook(book),pdf:book.pdfKey?{type:"upload",name:book.pdfName||"Book PDF"}:book.pdfUrl?{type:"url",name:"External PDF",url:book.pdfUrl}:null};}
function safeId(value,label="book"){const id=decodeURIComponent(String(value||""));const maximum=label==="cover"?160:140;if(!new RegExp(`^[a-zA-Z0-9._-]{1,${maximum}}$`).test(id)){const error=new Error(`Invalid ${label} identifier`);error.status=400;throw error;}return id;}
function cleanEdition(value){const edition=String(value||"").trim().replace(/\s+/g," ").slice(0,100);if(!edition){const error=new Error("Edition label is required");error.status=400;throw error;}return edition;}
function cleanFilename(value){const name=decodeURIComponent(String(value||"book.pdf")).replace(/[\\/:*?"<>|\u0000-\u001f]/g,"-").trim().slice(0,180);return name.toLowerCase().endsWith(".pdf")?name:`${name||"book"}.pdf`;}
function safeEqual(actual,expected){const left=Buffer.from(String(actual||""));const right=Buffer.from(String(expected||""));return left.length===right.length&&timingSafeEqual(left,right);}
function mutationAuthorized(request){const expected=process.env.ADMIN_TOKEN;if(!expected)return process.env.NODE_ENV!=="production"?{ok:true}:{ok:false,status:503,error:"admin_token_not_configured"};const supplied=request.headers.authorization?.replace(/^Bearer\s+/i,"");return safeEqual(supplied,expected)?{ok:true}:{ok:false,status:401,error:"administrator_access_required"};}
function requireAdmin(request,response){const auth=mutationAuthorized(request);if(!auth.ok){json(response,auth.status,{error:auth.error});return false;}return true;}

async function streamObject(response,object,{contentType,cacheControl="private, no-store",filename=""}={}){
  const headers={...SECURITY_HEADERS,"Cache-Control":cacheControl,"Content-Type":object.ContentType||contentType||"application/octet-stream",...(object.ContentLength?{"Content-Length":object.ContentLength}:{})};
  if(filename)headers["Content-Disposition"]=`inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
  response.writeHead(200,headers);object.Body.pipe(response);
}

async function handleApi(request,response,url){
  if(["POST","PUT","PATCH","DELETE"].includes(request.method||"")&&!requireAdmin(request,response))return true;
  if(request.method==="GET"&&url.pathname==="/api/books"){json(response,200,{books:(await listBooks()).map(publicBook)});return true;}
  if(request.method==="GET"&&url.pathname==="/api/themes"){json(response,200,{themes:await listThemes(),activeThemeId:await getActiveTheme()});return true;}
  if(request.method==="GET"&&url.pathname==="/api/admin/status"){if(!requireAdmin(request,response))return true;json(response,200,{authorized:true});return true;}
  if(request.method==="GET"&&url.pathname==="/api/admin/books"){if(!requireAdmin(request,response))return true;json(response,200,{books:(await listBooks()).map(adminBook)});return true;}
  if(request.method==="GET"&&url.pathname==="/api/admin/themes"){if(!requireAdmin(request,response))return true;json(response,200,{themes:await listThemes(),activeThemeId:await getActiveTheme()});return true;}
  if(request.method==="POST"&&url.pathname==="/api/admin/themes"){const input=validateThemeImport(await readJson(request));const themes=[];for(const theme of input)themes.push(await saveTheme(theme));json(response,200,{imported:themes.length,theme:themes[0],themes});return true;}
  if(request.method==="PUT"&&url.pathname==="/api/admin/themes/active"){const value=await readJson(request);const id=String(value.id||"");if(id&&!(await listThemes()).some((theme)=>theme.id===id)){json(response,404,{error:"theme_not_found"});return true;}await setActiveTheme(id);json(response,200,{activeThemeId:id});return true;}
  const themeMatch=url.pathname.match(/^\/api\/admin\/themes\/([a-z][a-z0-9-]{1,39})$/);
  if(request.method==="DELETE"&&themeMatch){const removed=await removeTheme(themeMatch[1]);json(response,removed?200:404,removed?{deleted:true,id:themeMatch[1]}:{error:"theme_not_found"});return true;}
  if(request.method==="GET"&&url.pathname==="/api/meta"){json(response,200,{name:"ShelfNotes",version:APP_VERSION,revision:BUILD_REVISION,booksPerPage:12,maxCoversPerBook:8,maxPdfBytes:MAX_PDF_BYTES});return true;}
  if(request.method==="POST"&&url.pathname==="/api/books"){const book=validateBook(await readJson(request),{allowId:false});json(response,201,{book:adminBook(await saveBook(book))});return true;}
  if(request.method==="POST"&&url.pathname==="/api/books/import"){const imported=validateImport(await readJson(request));const books=await importBooks(imported);json(response,200,{imported:imported.length,total:books.length,strategy:"merge",books:books.map(adminBook)});return true;}

  const coverUpload=url.pathname.match(/^\/api\/books\/([^/]+)\/(?:cover|covers)$/);
  if(request.method==="POST"&&coverUpload){
    const id=safeId(coverUpload[1]);const existing=await getBook(id);if(!existing){json(response,404,{error:"book_not_found"});return true;}
    const contentType=validateCoverType(request.headers["content-type"]).contentType;const buffer=await readBody(request,MAX_COVER_BYTES);if(!buffer.length){const error=new Error("Cover image is empty");error.status=400;throw error;}
    const edition=cleanEdition(url.searchParams.get("edition")||"Default edition");const uploaded=await uploadCover(id,buffer,contentType);
    try{await addBookCover(id,uploaded.key,uploaded.contentType,edition);}catch(error){await deleteObject(uploaded.key).catch(()=>{});throw error;}
    json(response,201,{book:adminBook(await getBook(id))});return true;
  }

  const primaryMatch=url.pathname.match(/^\/api\/books\/([^/]+)\/covers\/([^/]+)\/primary$/);
  if(request.method==="PATCH"&&primaryMatch){const bookId=safeId(primaryMatch[1]);const coverId=safeId(primaryMatch[2],"cover");const cover=await setPrimaryCover(bookId,coverId);if(!cover){json(response,404,{error:"cover_not_found"});return true;}json(response,200,{book:adminBook(await getBook(bookId))});return true;}
  const coverDelete=url.pathname.match(/^\/api\/books\/([^/]+)\/covers\/([^/]+)$/);
  if(request.method==="PATCH"&&coverDelete){const bookId=safeId(coverDelete[1]);const coverId=safeId(coverDelete[2],"cover");const edition=validateEdition(await readJson(request));const updated=await updateBookEdition(bookId,coverId,edition);if(!updated){json(response,404,{error:"edition_not_found"});return true;}json(response,200,{book:adminBook(await getBook(bookId))});return true;}
  if(request.method==="DELETE"&&coverDelete){const bookId=safeId(coverDelete[1]);const coverId=safeId(coverDelete[2],"cover");const cover=await getCover(coverId);if(!cover||cover.bookId!==bookId){json(response,404,{error:"cover_not_found"});return true;}await removeBookCover(coverId);await deleteObject(cover.objectKey).catch(()=>{});json(response,200,{book:adminBook(await getBook(bookId))});return true;}

  const pdfMatch=url.pathname.match(/^\/api\/books\/([^/]+)\/pdf$/);
  if(request.method==="POST"&&pdfMatch){const id=safeId(pdfMatch[1]);const existing=await getBook(id);if(!existing){json(response,404,{error:"book_not_found"});return true;}const buffer=await readBody(request,MAX_PDF_BYTES);const uploaded=await uploadPdf(id,buffer,request.headers["content-type"]);const filename=cleanFilename(request.headers["x-file-name"]);try{await setBookPdfFile(id,uploaded.key,filename,uploaded.contentType);}catch(error){await deleteObject(uploaded.key).catch(()=>{});throw error;}if(existing.pdfKey&&existing.pdfKey!==uploaded.key)await deleteObject(existing.pdfKey).catch(()=>{});json(response,201,{book:adminBook(await getBook(id))});return true;}
  if(request.method==="GET"&&pdfMatch){if(!requireAdmin(request,response))return true;const id=safeId(pdfMatch[1]);const book=await getBook(id);if(!book?.pdfKey){json(response,404,{error:"pdf_file_not_found"});return true;}const object=await readObject(book.pdfKey);await streamObject(response,object,{contentType:"application/pdf",filename:book.pdfName||"book.pdf"});return true;}
  if(request.method==="DELETE"&&pdfMatch){const id=safeId(pdfMatch[1]);const book=await getBook(id);if(!book){json(response,404,{error:"book_not_found"});return true;}await clearBookPdf(id);if(book.pdfKey)await deleteObject(book.pdfKey).catch(()=>{});json(response,200,{book:adminBook(await getBook(id))});return true;}

  const bookMatch=url.pathname.match(/^\/api\/books\/([^/]+)$/);
  if(request.method==="PUT"&&bookMatch){
    const id=safeId(bookMatch[1]);const existing=await getBook(id);if(!existing){json(response,404,{error:"book_not_found"});return true;}
    const book=validateBook({...await readJson(request),id});let updated=await saveBook(book);
    if(book.pdfUrl&&existing.pdfKey){await clearBookPdfFile(id);await deleteObject(existing.pdfKey).catch(()=>{});updated=await getBook(id);}
    json(response,200,{book:adminBook(updated)});return true;
  }
  if(request.method==="DELETE"&&bookMatch){const id=safeId(bookMatch[1]);const removed=await removeBook(id);if(!removed.removed){json(response,404,{error:"book_not_found"});return true;}await Promise.allSettled([...removed.covers.map((cover)=>deleteObject(cover.objectKey)),deleteObject(removed.pdfKey)]);json(response,200,{deleted:true,id});return true;}

  const imageMatch=url.pathname.match(/^\/api\/covers\/([^/]+)$/);
  if(request.method==="GET"&&imageMatch){const coverId=safeId(imageMatch[1],"cover");const cover=await getCover(coverId);if(!cover){json(response,404,{error:"cover_not_found"});return true;}const object=await readObject(cover.objectKey);await streamObject(response,object,{contentType:cover.contentType,cacheControl:"public, max-age=3600"});return true;}
  return false;
}

async function serveFile(request,response,pathname){let decoded;try{decoded=decodeURIComponent(pathname);}catch{json(response,400,{error:"invalid_path"});return;}const pageRoutes=new Map([["/admin","admin.html"],["/admin/","admin.html"]]);const relative=decoded==="/"?"index.html":pageRoutes.get(decoded)||decoded.replace(/^\/+/,"");const file=path.resolve(PUBLIC_DIR,relative);if(file!==PUBLIC_DIR&&!file.startsWith(PUBLIC_DIR+path.sep)){json(response,403,{error:"forbidden"});return;}try{const info=await stat(file);if(!info.isFile())throw new Error("not_file");const extension=path.extname(file).toLowerCase();response.writeHead(200,{...SECURITY_HEADERS,"Cache-Control":extension===".html"?"no-cache":"public, max-age=3600","Content-Type":TYPES.get(extension)||"application/octet-stream","Content-Length":info.size});if(request.method==="HEAD")response.end();else createReadStream(file).pipe(response);}catch{json(response,404,{error:"not_found"});}}
function apiError(response,error){const configError=["DATABASE_NOT_CONFIGURED","S3_NOT_CONFIGURED"].includes(error.code);const status=error.status||(configError?503:500);if(status>=500&&!configError)console.error("Request failed:",error);json(response,status,{error:configError?error.code.toLowerCase():(status>=500?"internal_server_error":error.message),...(configError?{message:error.message}:{})});}

export function startServer(port=Number(process.env.PORT||3000)){const server=createServer(async(request,response)=>{const url=new URL(request.url||"/","http://localhost");if(request.method==="GET"&&url.pathname==="/healthz"){json(response,200,{status:"ok",service:"shelfnotes",version:APP_VERSION});return;}if(request.method==="GET"&&url.pathname==="/readyz"){const dependencies={database:"unknown",storage:"unknown"};try{dependencies.database=(await databaseReady()).mode;}catch{dependencies.database="unavailable";}try{dependencies.storage=(await storageReady()).mode;}catch{dependencies.storage="unavailable";}const ready=dependencies.database!=="unavailable"&&(process.env.NODE_ENV!=="production"||dependencies.storage==="s3");json(response,ready?200:503,{status:ready?"ready":"degraded",dependencies});return;}try{if(url.pathname.startsWith("/api/")&&await handleApi(request,response,url))return;if(["GET","HEAD"].includes(request.method||"")){await serveFile(request,response,url.pathname);return;}json(response,405,{error:"method_not_allowed"});}catch(error){apiError(response,error);}});server.listen(port,"0.0.0.0",()=>console.log(`ShelfNotes listening on 0.0.0.0:${server.address().port}`));return server;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=startServer();const shutdown=()=>server.close(()=>closeDatabase().finally(()=>process.exit(0)));process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);}
