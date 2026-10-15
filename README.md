# ShelfNotes Book Summary

Current release: **v4.2.0**

ShelfNotes is a persistent book-summary web service prepared for NEO App. PostgreSQL stores the shared library, while S3-compatible Object Storage stores private edition-cover images and optional PDF files. Importing JSON **merges** records by book ID; it does not erase books that are already in the database.

## What is included

- Public, read-only library with search and multi-tag filtering
- Pagination at **12 books per page**, chosen to divide evenly across four-, three-, two-, and one-column layouts
- A visitor-local clock with date and IANA timezone plus a randomized memorable line from stored books
- Separate `/admin.html` workspace for all book CRUD, full-library import/export, and cover management
- Up to 12 tags per book; the first tag remains the backward-compatible primary `genre`
- Structured chapter-by-chapter summaries and core takeaways
- Chapter-only JSON import inside the add/edit form
- Compact mobile cards, controls, and full-screen mobile edit/detail dialogs
- Persistent PostgreSQL storage shared by browsers and devices
- Merge/upsert JSON import with a 500-book limit per file
- Up to 8 labeled edition covers per book, with administrator controls for the primary cover and deletion
- Self-hosted OFL-licensed Literata reading text and Inter interface text, with no runtime font CDN dependency
- Per-browser reading controls for serif/sans type, 15–22 px text, 1.5–1.7 line spacing, and app/paper/sepia/night pages
- Cover upload to S3-compatible Object Storage, maximum 5 MiB per image
- One optional administrator-only PDF source per book: either an external HTTP(S) URL or a private S3 PDF upload
- Private PDF uploads are validated by content signature, limited to 25 MiB by default, and never exposed by the public books API
- Same-origin cover delivery, so the S3 bucket can remain private
- Production write protection with `ADMIN_TOKEN`
- Visible application version and optional deployment revision on both public and admin pages
- One-time migration of data saved by the older browser-only version
- `/healthz` liveness and `/readyz` dependency checks
- Dockerfile, non-root runtime, graceful shutdown, and security headers

## Before deploying

Create these two NEO App resources in the same project:

1. A **NEO DB / PostgreSQL** database.
2. An **S3-compatible Object Storage** bucket for edition covers and optional private PDFs.

Copy their connection values into the Web Service environment variables described below. Do not commit real passwords, access keys, or `ADMIN_TOKEN` to Git.

## Deploy on NEO App

### 1. Create the database

1. Open the target NEO App project.
2. Create a PostgreSQL/NEO DB resource.
3. Wait until it is ready.
4. Copy its PostgreSQL connection string. It becomes `DATABASE_URL`.

The service can update its schema automatically when `DATABASE_AUTO_MIGRATE=true`. Version 4 adds PDF metadata columns and a relational `book_covers` table. Each previous single cover is copied into the new table as `Default edition` in primary position without deleting its S3 object. Existing summaries, tags, chapters, and media remain available. Let the first deployment after this update run with migration enabled; after verifying the migration, you may optionally change it to `false`.

### 2. Create Object Storage

1. Create or select an S3-compatible bucket.
2. Keep the bucket private; public-read access is not required.
3. Create credentials permitted to read, write, and delete objects in that bucket. Restrict access to this application's prefixes when supported.
4. Record the endpoint, region, bucket name, access key, and secret key.

### 3. Create the Web Service

| NEO App field | Value |
|---|---|
| Service name | `shelfnotes` |
| Repository URL | Your Git repository URL |
| Branch | `main` or your actual branch |
| Git profile | Public repo, or connect your account for a private repo |
| Root directory | `demo-example/book-summary` in this monorepo; blank if this folder is the repository root |
| Build method | Build File / Dockerfile |
| Build file | `Dockerfile` |
| Start command | Leave empty |
| Container/service port | `3000` |
| Health-check path | `/healthz` |
| Readiness path | `/readyz`, when available |
| Public access | Enabled |

Attach the NEO DB if the form provides an attachment control. The important result is that the Web Service receives a usable `DATABASE_URL`.

### 4. Add environment variables

| Variable | Required value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_VERSION` | Optional override; omit it to use the version in `package.json` (`3.0.0`) |
| `BUILD_REVISION` | Optional Git commit, image tag, or deployment identifier shown beside the version |
| `DATABASE_URL` | PostgreSQL connection string from NEO DB |
| `DATABASE_AUTO_MIGRATE` | `true` for the initial deployment |
| `ADMIN_TOKEN` | A long, random secret known only to administrators |
| `S3_ENDPOINT` | Full S3-compatible endpoint URL, including `https://` |
| `S3_REGION` | Storage region, or `us-east-1` when the provider requires a value but does not specify one |
| `S3_BUCKET` | Existing bucket name |
| `S3_ACCESS_KEY` | Object Storage access key |
| `S3_SECRET_KEY` | Object Storage secret key |
| `S3_FORCE_PATH_STYLE` | `true` for path-style providers; use `false` only when the provider documents virtual-host addressing |
| `MAX_PDF_BYTES` | Optional PDF limit in bytes; defaults to `26214400` (25 MiB) |

NEO App supplies `PORT`; do not override it unless the platform form explicitly requires port `3000`. See [.env.example](./.env.example) for a copyable template.

### 5. Approve and verify

1. Approve the deployment and wait until the pod is running.
2. Open the public URL plus `/healthz`. It should return `status: ok`.
3. Open `/readyz`. It should return HTTP 200 with `database: postgres` and `storage: s3`.
4. Open `/admin.html` from the **Manage library** link.
5. Enter the same value configured as `ADMIN_TOKEN`. It is kept only in that browser tab's session storage.
6. Add at least 13 summaries and confirm the public shelf shows 12 on page one and the remainder on page two.
7. Add two edition covers to one book, open **Media**, set the second one as primary, and confirm the public card and detail gallery update.
8. Add either a PDF URL or PDF file. Confirm **Media** can open it while `/api/books` contains no PDF metadata.
9. Edit that book, add chapters manually or choose **Import chapter JSON**, and confirm the update appears without creating a duplicate.
10. Confirm the public page shows local time and a memorable line; use the refresh control to select another quote.
11. Import a JSON backup and confirm existing summaries and media remain present.

Visitors can view and filter summaries without the token. All content management is on `/admin.html`; adding, editing, importing, uploading, and deleting require administrator access in production.

## JSON import behavior

- A new ID creates a new summary.
- An existing ID updates that summary's text but preserves its current edition covers and uploaded PDF.
- `tags` is an array of up to 12 strings. Older files containing only `genre` remain valid and become a one-tag book.
- Chapter notes use `chapters: [{ "title": "...", "summary": "...", "takeaways": ["..."] }]`; older files without `chapters` remain valid.
- Summaries not included in the file remain in the database.
- A record without an ID receives a new ID and is added.
- Cover and PDF binaries are not embedded in JSON exports. Edition covers and uploaded PDFs remain in Object Storage.
- An external PDF URL may be imported for a newly created record. A merge into an existing ID preserves that record's current PDF source to avoid silently replacing private media.

## Import chapter summaries while editing

1. Open `/admin.html`, unlock it, and select **Edit** on a book.
2. In **Chapter breakdown**, select **Import chapter JSON**.
3. Choose a JSON file containing either a direct chapter array or `{ "chapters": [...] }`.
4. Review the generated fields. Importing replaces only the chapter fields currently in the form; it does not save anything yet.
5. Select **Update summary** to persist the chapters in NEO DB.

Use [examples/chapters.example.json](./examples/chapters.example.json) as a beginner-friendly template. Each chapter requires `title` and `summary`; `takeaways` is an optional string array. A book can contain at most 80 chapters.

## Version information

- The release version comes from `package.json` and is shown in the public footer and admin header.
- `APP_VERSION` can override the package version when a deployment pipeline needs a different release label.
- `BUILD_REVISION` is optional and should contain a short non-secret Git commit, image tag, or deployment identifier.
- `GET /api/meta` returns the public version metadata.
- `GET /healthz` includes the version to make runtime verification easier.
- Increase the package version whenever a deployable behavior or schema changes. Version `4.2.0` adds self-hosted reading typography and persistent reader preferences while retaining the legacy-cover and interaction improvements.

### Font licensing

The bundled Inter and Literata webfonts use the SIL Open Font License 1.1. Their license notices are included beside the WOFF2 files in `public/fonts`. ShelfNotes serves these files itself; visitor browsers do not contact Google Fonts or another font CDN.

## Migrating the old browser-only library

If this domain contains data created by the previous `localStorage` version, the dashboard displays a migration notice. Select **Admin access** and enter `ADMIN_TOKEN`. The app merges those browser records into PostgreSQL once and records a local migration marker. Export the old data first if you want an extra backup.

## Run locally

Node.js 20 or newer is required.

```powershell
Set-Location 'demo-example\book-summary'
npm install
npm test
npm run check
npm start
```

Without `DATABASE_URL`, local development automatically uses temporary in-memory storage. It resets when the Node process restarts. Cover upload still requires S3 variables. To test PostgreSQL locally, copy `.env.example` values into your environment; the server intentionally does not load `.env` files by itself.

## Troubleshooting

| Symptom | What to check |
|---|---|
| `/readyz` returns 503 | Confirm `DATABASE_URL` and every `S3_*` variable; verify network access and credentials |
| Add/import/delete returns 401 | Choose **Admin access** and enter the exact `ADMIN_TOKEN` value |
| Mutation returns `admin_token_not_configured` | Add `ADMIN_TOKEN` to the Web Service and redeploy |
| Cover upload says `s3_not_configured` | Add all S3 variables and redeploy |
| Cover upload is 403 | Confirm bucket permission for GetObject, PutObject, and DeleteObject |
| Cover upload is 413 | Resize the file to 5 MiB or smaller |
| PDF upload is 413 | Reduce the PDF below `MAX_PDF_BYTES`, or raise the limit deliberately and verify platform request limits |
| PDF upload is 415 | Upload a genuine PDF beginning with the `%PDF-` signature rather than a renamed file |
| PDF is visible to public visitors | Do not place its URL in summary text; PDF metadata belongs only in the admin PDF fields and `/api/admin/books` |
| Older cover is missing after upgrade | Version 4.0.1 serves the legacy `cover_key` as a compatibility fallback. Keep `DATABASE_AUTO_MIGRATE=true` for one deployment to copy it into `book_covers` permanently. Also verify `/readyz` reports `storage: s3`. |
| Public URL returns 502/504 | Confirm port `3000`, leave Start Command empty, and inspect `/healthz` plus deployment logs |
| Database table is missing | Temporarily set `DATABASE_AUTO_MIGRATE=true` and redeploy |
| Chapter section does not appear after upgrading | Set `DATABASE_AUTO_MIGRATE=true` for one deployment so the `chapters` column is added |
| Old browser notes are not migrated | Open `/admin.html`, unlock it with the correct token, and keep the same public domain/browser storage |
| Tags do not appear after upgrading | Set `DATABASE_AUTO_MIGRATE=true` for one deployment so the `tags` column is added and populated from `genre` |
| Chapter JSON import fails | Use an array or `{ "chapters": [...] }`; every item needs a non-empty `title` and `summary` |

## Repository layout

```text
book-summary/
├── lib/
│   ├── database.mjs
│   ├── storage.mjs
│   └── validation.mjs
├── public/
│   ├── admin.html
│   ├── admin.js
│   ├── app.js
│   ├── icon.svg
│   ├── index.html
│   └── styles.css
├── examples/
│   └── chapters.example.json
├── scripts/validate.mjs
├── tests/server.test.mjs
├── .env.example
├── Dockerfile
├── package.json
├── server.mjs
└── README.md
```

The original HTML and content notes remain as design references and are excluded from the runtime container by `.dockerignore`.
