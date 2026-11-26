# intgrte — Backend

API and worker for reading Zenoti invoices, managing Finance review, and sending Sales Invoices to Accurate Online. Built with Express, TypeScript, Better Auth, Drizzle ORM, and MySQL 8.4 LTS.

## Main Workflow

1. Uploading PDF/Excel files creates drafts and previews; uploading does not queue transactions for delivery.
2. Finance reviews items, totals, invoice status, and Accurate customer/item mappings.
3. Submission validates the draft and prepares delivery through the worker.
4. Delivery results and failures are recorded for review and audit.

Redeemed items and complimentary Consultation services are not sent to Accurate. Fully redeemed invoices are stored locally; mixed invoices send only items eligible for recognition. Invoice numbers already used in Accurate are held for duplicate review. Sales Invoices and Sales Receipts have separate review steps, submission confirmations, and queues.

### Sales Receipts

Payments from invoices with verified Accurate Sales Invoices can be reviewed, saved as drafts, and submitted after Finance confirmation. Settings provides cash/bank and expense account mappings and configurable default rates for each company, bank, and payment method. Initial BCA/BNI defaults are credit card 2%, debit 1.8%, QRIS 0.7%, and direct bank transfer 0%. Finance can override a draft receipt's rate without changing Settings; successful receipts retain their stored rates. Fractional fees are always rounded up. The receipt queue checks the latest balance and verifies results without repeating invoice delivery. Uncertain delivery results are reconciled through vendor reads. See the [receipt workflow, API contract, and UAT limitations](docs/sales-receipts.md).

### Creating Accurate Customers

Super Admin and Finance can create customers when a search returns no results during invoice review. `GET /api/accurate/imports/:batchId/rows/:rowId/customer/prepare?version=...` scans all customer pages in descending Accurate ID order and uses the largest numeric MPA suffix plus one. Each required active master record must have exactly one match: category `Astetic`, branch `PT Mylab Prima Inovatif`, currency `IDR`, price/discount category `Umum`, and payment terms `C.O.D`. Discount category mapping uses the price category master in the API collection. The branch must match the invoice destination; if no MPA number exists, numbering must first be reviewed in Accurate.

`POST /api/accurate/imports/:batchId/rows/:rowId/customer` accepts `requestId`, `version`, `databaseId`, `customerNo`, and `name`. The backend revalidates numbering, duplicate names, default master records, the live connection, and the draft before sending only General/Sales fields to `customer/save.do`. Requests are durably recorded in the audit log before the POST. Repeated requests with the same identity only check the result in Accurate; uncertain responses do not trigger another POST. Numbers and names being processed are reserved to prevent concurrent requests from reusing them. Customers created successfully but not mapped can be reused through the Use customer action or a regular search. The invoice still requires review and submission. This feature does not require database schema changes.

## Requirements

- Node.js **22.16 or later** and npm.
- MySQL 8.4 LTS (InnoDB); Docker Compose provides MySQL 8.4.13 for local development.

Related frontend: [accurate-zenoti-integration](https://github.com/itd-medquest/accurate-zenoti-integration). Clone the repositories into sibling folders named `frontend` and `backend` when running frontend integration tests.

## Local Setup with MySQL

```powershell
git clone https://github.com/itd-medquest/be-accurate-zenoti-integration.git backend
cd backend
npm ci
Copy-Item .env.example .env
```

Complete `.env`, particularly the authentication secret, encryption key, and local seed account settings. Use the same password in `DATABASE_URL` and `MYSQL_PASSWORD`; configure a separate `MYSQL_ROOT_PASSWORD` for Compose.

Run the following command twice to generate random values: use one result for `BETTER_AUTH_SECRET` and a different result for `ENCRYPTION_KEY`.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Start the database, apply migrations, and initialize the development environment:

```powershell
docker compose up -d mysql
npm run db:migrate
npm run db:seed:admin
npm run db:setup:company
npm run dev
```

The API is available at `http://localhost:4000`. Service health endpoint: `GET /api/health`. The admin-only seed creates the initial account without invoices. Company setup requires SETUP_COMPANY_ID/NAME and SETUP_CENTER_ID. To populate a separate development database with demo data, `npm run db:seed` remains available.

If your laptop uses the portable MySQL installation initialized during migration, restart the database after rebooting the laptop and before starting the backend:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-mysql-local.ps1
npm run dev
```

The launcher reads the private descriptor `data/mysql-local-runtime.json` and uses the existing database. The local portable installation uses port 3307; Compose uses 3306. A startup `ECONNREFUSED` error means the connection was refused: verify that MySQL is running and that the host/port in `DATABASE_URL` are correct. Once the backend is ready, `GET /api/health` should return HTTP 200 with `status: "ok"` and `queue: "mysql"`.

### Deployment with an Empty Database

The database structure is created from repository migrations without copying local data. Follow the [main MySQL setup guide for the dev server](docs/mysql-migration.md): environment configuration, migrations, initial Super Admin seed, PT. MMI setup, Accurate connections/destinations, and the eight BCA/BNI Sales Receipt mappings. The guide also includes reference general ledger account codes, rates, rounding rules, and a UAT checklist. See the [deployment guide](docs/deployment.md) for account bootstrap behavior on subsequent runs.

### Transferring Legacy Local Accounts

This optional process is separate from setting up a new server. Use an encrypted export and import it into an empty MySQL database before creating companies or configuration. Passwords, roles, and account status are preserved; invoices, history, sessions, and Accurate configuration are not copied. Legacy PostgreSQL migrations remain archived; only `src/db/migrations/mysql/` is applied. Follow the [PostgreSQL/PGlite source backup and account transfer guide](docs/postgresql-user-transfer.md).

## Environment Configuration

See `.env.example` for the complete list of variables and example values.

| Variable                                                     | Purpose                                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                       | API port; local default: `4000`                                                                                                   |
| `FRONTEND_URL`                                               | Allowed frontend origin; default: `http://localhost:3000`                                                                         |
| `BETTER_AUTH_URL`                                            | Public backend URL for authentication                                                                                             |
| `BETTER_AUTH_SECRET`                                         | Authentication secret, at least 32 characters                                                                                     |
| `DATABASE_URL`                                               | `mysql://` connection to MySQL 8.4 LTS                                                                                            |
| `DATABASE_SSL`                                               | `true` for TLS with certificate verification; local default: `false`                                                              |
| `ENCRYPTION_KEY`                                             | Credential encryption key, 64 hexadecimal characters; retain it to read previously stored credentials                             |
| `INTEGRATION_MODE`                                           | Base mode: `simulation` or `live`; live Accurate connections are managed explicitly through Settings                              |
| `RUN_WORKER`                                                 | `true` to run the worker inside the API process                                                                                   |
| `IMPORT_PACKAGE_TAX_POLICY`                                  | Package tax allocation policy; the local example uses `proportional`                                                              |
| `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Optional name, email, and password for admin bootstrap; `db:seed:admin` creates only the first admin; password: 12–128 characters |
| `RESEND_API_KEY`, `RESEND_FROM`                              | Password-reset email delivery configuration                                                                                       |

The Accurate API Token and Signature Secret are entered through Settings and stored encrypted. Simulation does not require the Zenoti API; the upload workflow reads invoices from PDF/Excel files. PDF parsing and OCR fallback run locally using installed dependencies.

Password recovery uses OTP through Resend and requires `RESEND_API_KEY` and a `RESEND_FROM` address from a verified domain to deliver emails to team members. New users currently receive an initial password from an admin; email invitations/activation are not available yet. See the [email and OTP readiness audit](docs/email-readiness.md) for configuration, test results, and reverse proxy/email delivery requirements.

Source invoice files are stored privately in `data/imports`. Configure persistent storage for this directory during deployment and exclude it from Git.

Super Admin can add, rename, and delete companies through **Settings → Companies**, then configure each company's Accurate connection, destination, and receipt accounts. Each new company uses its own credentials. Deletion requires company-name confirmation and remains blocked by active uploads or transactions; deleted-only unsubmitted previews are retained for audit while the company is removed from selection. See the [company management guide](docs/company-management.md).

## Commands

Run these commands from the backend repository directory.

| Command                    | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`              | Start the API with source-change monitoring                                    |
| `npm run typecheck`        | Check TypeScript                                                               |
| `npm test`                 | Run backend tests                                                              |
| `npm run build`            | Build `dist/` and copy migrations                                              |
| `npm start`                | Run the production build                                                       |
| `npm run db:migrate`       | Apply database migrations                                                      |
| `npm run db:generate`      | Generate migrations from schema changes                                        |
| `npm run db:seed`          | Populate development accounts and sample data                                  |
| `npm run db:seed:admin`    | Create the first Super Admin without demo data; do not reset existing accounts |
| `npm run db:setup:company` | Add an empty company to configure in Settings                                  |
| `npm run db:export:users`  | Export encrypted PostgreSQL/PGlite accounts                                    |
| `npm run db:import:users`  | Import accounts into a new MySQL database without overwriting users            |
| `npm run worker`           | Run a separate worker using MySQL                                              |

When running a separate worker, set `RUN_WORKER=false` on the API process. For deployment, use MySQL and the target environment configuration, apply reviewed migrations, and bootstrap the first Super Admin with `db:seed:admin` according to the [deployment guide](docs/deployment.md). The development seed, `db:seed`, is not part of deployment.

## Frontend Integration Tests

Set `TEST_DATABASE_URL` in the environment or a private `.env.test.local`. Tests create separate `imp_test_*` MySQL schemas and do not use the application database.

The backend provides a fixture at `test/helpers/browser-server.ts` with a temporary database and mocked Accurate responses:

```powershell
npx tsx scripts/prepare-import-assets.ts
$env:ACCURATE_MOCK_SERVER = 'true'
npx tsx test/helpers/browser-server.ts
```

The fixture requires local seed account settings in `.env`, runs on port `4001`, and expects the frontend on port `3001`. The template script writes anonymous Excel examples to `../../docs/templates/`. Follow the frontend README to start the application and Playwright against these fixture addresses.

## Project Structure

```text
src/
  routes/         API endpoints
  validations/    Request schemas and validation
  controllers/    HTTP translation
  services/       Business rules and transaction orchestration
  repositories/   Database access
  db/             Connections, schemas, migrations, and seeds
  config/         Environment configuration
  middlewares/    Authentication, authorization, and error handling
  utils/          Shared parsers and calculations
test/             Backend tests and fixtures
scripts/          Builds, PDF extraction, and local utilities
```

Request flow: **route → validation → controller → service → repository → database**. Preserve audit records, versioning, idempotency, and total validation when changing invoice workflows.

## Git Rules

Create a branch for each change, include migrations when needed, run `npm run typecheck`, `npm test`, and `npm run build`, then open a pull request. Keep `package-lock.json` and migration history. Exclude local environments, credentials, databases, source documents, and build/test artifacts from commits.

Package Benefit extraction, nominal/percentage discount requests, and audited review exceptions are documented in the [package review guide](docs/package-benefit-review.md).

Multiple payments and partial bank settlements, including the required additive MySQL migration, are documented in the [partial receipts guide](docs/partial-receipts.md).
