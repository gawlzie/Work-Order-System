# Work Order Service (WOS)

A repair work-order management system for heavy equipment (dump trucks), modelled on
Inline Technology International's WOS (`wos-stg.iti.co.id`). It runs fully standalone with its own
API and database. No SSO or external API is needed.

## Features

| Area | What it does |
| --- | --- |
| **Login / roles** | Admin Plant (full access), Mechanic (create WO + progress steps), Driver (view only) |
| **Dashboard** | Open / On Progress / Waiting / Finish counters, total WOs, pending approvals, average and total repair time, WOs per category, list with status tabs and a date range |
| **Work Order list** | Search, filters (status, approval, channel source, unit, PIC mechanic, category, date range), sortable columns, pagination, CSV export, print |
| **Approval** | WOs raised by mechanics (mobile) or WhatsApp wait for approval. Admin approves or rejects them with a reason. WOs created on the web are approved by the system |
| **Create / Update** | Unit (dump truck), driver, PIC mechanic, repair category, problem description, with validation and a confirmation dialog. Only one active WO is allowed per unit |
| **Detail** | Unit/driver/PIC info and a step timeline with sub-steps (PIC, start, finish, duration, remarks). Steps are started and finished in order. Additional work can be added. Printable |
| **Status logic** | `OPEN` → `ON_PROGRESS` → `WAITING` (while the *Waiting Part* step runs) → `FINISH` (when all steps are done), derived automatically from the steps |
| **App page, Profile** | Landing page for the Android mechanic app; profile page with password change |
| **UX** | English / Bahasa Indonesia, light/dark theme, responsive layout with a collapsible sidebar |

## Tech stack

- **server/**: Node.js 22.13+ with Express and the built-in `node:sqlite` (nothing native to compile), scrypt password hashing and HMAC-signed tokens
- **client/**: React 18, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router, lucide icons

## Getting started

```bash
npm run install:all      # installs root, server and client dependencies
npm run dev              # API on :4000, web on http://localhost:5173
```

Production (single process, serves the built client):

```bash
npm run build
npm start                # http://localhost:4000
```

Reset the demo data with `npm run seed`. The database is stored in `server/data/wos.db`.

### Demo accounts (password `password123`)

| Username | Role |
| --- | --- |
| `admin` | Admin Plant |
| `budi`, `agus`, `rudi` | Mechanic |
| `joko` | Driver (view only) |

### Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API / web port |
| `WOS_DB` | `server/data/wos.db` | SQLite file path |
| `WOS_SECRET` | random, saved in `server/data/secret.key` | Token signing secret |

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>`, except login.

```
POST   /auth/login                 GET  /auth/profile        POST /auth/change-password
GET    /dashboard?start_date&end_date
GET    /work-orders?search&status&approval_status&channel_source&unit_id&mechanic_id&category_id
                    &created_start&created_end&sort_by&sort_order&page&limit
GET    /work-orders/export         (CSV, same filters)
GET    /work-orders/:id            POST /work-orders          PUT /work-orders/:id     DELETE /work-orders/:id
POST   /work-orders/:id/approval   { action: APPROVE | REJECT, reason }
POST   /work-orders/:id/steps/:stepId/start|finish   { remarks }
POST   /work-orders/:id/additional-work              { name }
GET    /master/units  /master/employees?role=driver|mechanic  /master/repair-categories
```
