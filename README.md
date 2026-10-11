# ShelfNotes Book Summary

ShelfNotes is a persistent book-summary web service prepared for NEO App. PostgreSQL stores the shared library, while S3-compatible Object Storage stores private JPEG, PNG, or WebP cover files. Importing JSON **merges** records by book ID; it does not erase books that are already in the database.

## What is included

- Add, browse, search, filter, export, import, and delete summaries
- Persistent PostgreSQL storage shared by browsers and devices
- Merge/upsert JSON import with a 500-book limit per file
- Cover upload to S3-compatible Object Storage, maximum 5 MiB
- Same-origin cover delivery, so the S3 bucket can remain private
- Production write protection with `ADMIN_TOKEN`
- One-time migration of data saved by the older browser-only version
- `/healthz` liveness and `/readyz` dependency checks
- Dockerfile, non-root runtime, graceful shutdown, and security headers

## Before deploying

Create these two NEO App resources in the same project:

1. A **NEO DB / PostgreSQL** database.
2. An **S3-compatible Object Storage** bucket for book covers.

Copy their connection values into the Web Service environment variables described below. Do not commit real passwords, access keys, or `ADMIN_TOKEN` to Git.

## Deploy on NEO App

### 1. Create the database

1. Open the target NEO App project.
2. Create a PostgreSQL/NEO DB resource.
3. Wait until it is ready.
4. Copy its PostgreSQL connection string. It becomes `DATABASE_URL`.

The service can create its `book_summaries` table automatically when `DATABASE_AUTO_MIGRATE=true`. For a controlled production release, let the first deployment create the table, then optionally change this value to `false`.

### 2. Create Object Storage

1. Create or select an S3-compatible bucket.
2. Keep the bucket private; public-read access is not required.
3. Create credentials permitted to read, write, and delete objects in that bucket.
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
| `DATABASE_URL` | PostgreSQL connection string from NEO DB |
| `DATABASE_AUTO_MIGRATE` | `true` for the initial deployment |
| `ADMIN_TOKEN` | A long, random secret known only to administrators |
| `S3_ENDPOINT` | Full S3-compatible endpoint URL, including `https://` |
| `S3_REGION` | Storage region, or `us-east-1` when the provider requires a value but does not specify one |
| `S3_BUCKET` | Existing bucket name |
| `S3_ACCESS_KEY` | Object Storage access key |
| `S3_SECRET_KEY` | Object Storage secret key |
| `S3_FORCE_PATH_STYLE` | `true` for path-style providers; use `false` only when the provider documents virtual-host addressing |

NEO App supplies `PORT`; do not override it unless the platform form explicitly requires port `3000`. See [.env.example](./.env.example) for a copyable template.

### 5. Approve and verify

1. Approve the deployment and wait until the pod is running.
2. Open the public URL plus `/healthz`. It should return `status: ok`.
3. Open `/readyz`. It should return HTTP 200 with `database: postgres` and `storage: s3`.
4. Open the dashboard and choose **Admin access**.
5. Enter the same value configured as `ADMIN_TOKEN`. It is kept only in that browser tab's session storage.
6. Add one summary with a cover, refresh the page, and confirm it remains visible.
7. Open another browser, load the public URL, and confirm the summary is visible there too.
8. Import a JSON backup and confirm existing summaries remain present.

Visitors can view summaries without the token. Adding, importing, uploading, and deleting require administrator access in production.

## JSON import behavior

- A new ID creates a new summary.
- An existing ID updates that summary's text but preserves its current cover.
- Summaries not included in the file remain in the database.
- A record without an ID receives a new ID and is added.
- Cover image binaries are not embedded in JSON exports; exported records keep their cover metadata, while actual files remain in Object Storage.

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
| Public URL returns 502/504 | Confirm port `3000`, leave Start Command empty, and inspect `/healthz` plus deployment logs |
| Database table is missing | Temporarily set `DATABASE_AUTO_MIGRATE=true` and redeploy |
| Old browser notes are not migrated | Enter Admin access, verify the token, and keep the same public domain/browser storage |

## Repository layout

```text
book-summary/
├── lib/
│   ├── database.mjs
│   ├── storage.mjs
│   └── validation.mjs
├── public/
│   ├── app.js
│   ├── icon.svg
│   ├── index.html
│   └── styles.css
├── scripts/validate.mjs
├── tests/server.test.mjs
├── .env.example
├── Dockerfile
├── package.json
├── server.mjs
└── README.md
```

The original HTML and content notes remain as design references and are excluded from the runtime container by `.dockerignore`.
