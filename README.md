# ShelfNotes Book Summary

ShelfNotes is a self-contained digital bookshelf for saving and revisiting personal book summaries. It is designed to deploy as one public NEO App Web Service with no database or external API.

## Included functionality

- Responsive book-summary cards and detailed reading-note dialog
- Search across title, author, genre, big idea, audience, and takeaways
- Dynamic genre filters
- Add and delete summaries
- Browser-local persistence with `localStorage`
- JSON export and import for backup or browser migration
- Total-book, consecutive-reading-day, and top-genre statistics
- System theme plus all ten supplied color palettes
- Accessible native dialogs and keyboard focus states
- Dependency-free Node.js server
- `/healthz` and `/readyz` NEO App probes
- Container health check, security headers, and graceful shutdown

## Important storage behavior

Book summaries are stored in the visitor's browser—not in the NEO App container. This is intentional for the current personal bookshelf design:

- Data survives page reloads and ordinary redeployments when the same browser storage remains available.
- Data does not automatically synchronize between browsers, devices, or users.
- Clearing site data removes locally saved books.
- Use **Export JSON** regularly and **Import JSON** to restore or move the library.

A database is not required for this version. Add NEO DB and user authentication only if shared accounts or multi-device synchronization become requirements.

## Run locally

Requirements: Node.js 20 or newer.

```powershell
Set-Location 'demo-example\book-summary'
npm install
npm test
npm run check
npm start
```

Open <http://localhost:3000>. Verify:

- <http://localhost:3000/healthz>
- <http://localhost:3000/readyz>

Docker alternative:

```powershell
docker build -t shelfnotes .
docker run --rm -p 3000:3000 shelfnotes
```

## Deploy on NEO App — recommended Web Service

Push this folder to its own repository, or use it as a directory in your existing monorepo. In NEO App, create a **Web Service** and enter:

| NEO App field | Value |
|---|---|
| Service name | `shelfnotes` or another lowercase name |
| Repository URL | Your Git repository URL |
| Branch | `main` or your actual branch |
| Git profile | Public repository, or connect the account for a private repository |
| Root directory | `demo-example/book-summary` for this workspace monorepo; leave blank if this folder is the repository root |
| Build method | Build File / Dockerfile |
| Build file | `Dockerfile` |
| Start command | Leave empty |
| Container/service port | `3000` |
| Health-check path | `/healthz` |
| Readiness path | `/readyz` if the field is available |
| Public access | Enabled |
| Replicas | `1` is sufficient |

No environment variables, database, queue, object storage, persistent volume, or custom domain are required. The server automatically uses NEO App's `PORT` value and listens on `0.0.0.0`.

After approval and deployment:

1. Wait until the deployment and pod show healthy or running.
2. Open the generated public URL plus `/healthz`; it must return `{"status":"ok","service":"shelfnotes"}`.
3. Open the public root URL.
4. Add a summary and refresh the page; it should remain in that browser.
5. Test search, a genre filter, theme selection, JSON export, and JSON import.
6. Open the same site in a private window to confirm that browser-local data is intentionally separate.

## Optional NEO Static Site deployment

The browser application itself is static and has no API dependency. If NEO App's Static Site type accepts a directory containing an existing `index.html`, use:

| Field | Value |
|---|---|
| Repository URL | Your Git repository URL |
| Branch | `main` or your actual branch |
| Root directory | `demo-example/book-summary/public` for this monorepo; `public` if this folder is the repository root |

The Web Service deployment is recommended for testing because it provides explicit health endpoints and a known container port.

## Troubleshooting

| Symptom | Check |
|---|---|
| Build cannot find `Dockerfile` | Confirm the root directory points to the folder containing `Dockerfile` |
| Public URL returns `502` or `504` | Confirm service port `3000`, leave Start Command empty, and check `/healthz` in deployment logs |
| Public URL returns `404` | Confirm public access is enabled and the generated domain is attached to this Web Service |
| Books disappear in another browser | Expected: current storage is browser-local; export/import the JSON backup |
| Books disappear after clearing browser data | Restore the latest exported JSON file |
| Theme resets | Confirm browser storage is allowed for the public domain |

## Repository layout

```text
book-summary/
├── public/
│   ├── app.js
│   ├── icon.svg
│   ├── index.html
│   └── styles.css
├── scripts/validate.mjs
├── tests/server.test.mjs
├── Dockerfile
├── package.json
├── server.mjs
└── README.md
```

The original HTML, feature list, and palette document remain in the repository as design references. They are excluded from the runtime container by `.dockerignore`.

## Verify before pushing

```powershell
npm test
npm run check
docker build -t shelfnotes .
```

Only the first two commands require Node.js. The final command requires Docker.
