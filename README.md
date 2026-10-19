# Work Order Service (WOS)

A repair work-order management system for heavy equipment (dump trucks), modelled on
Inline Technology International's WOS (`wos-stg.iti.co.id`). It runs fully standalone with its own
API and database. No SSO or external API is needed.

## Features

| Area | What it does |
| --- | --- |
| **Login / roles** | Permission-based roles. Built-in: Admin Plant (full access), Mechanic (create WO + progress steps), Driver (view only); more can be added in Master Data |
| **Dashboard** | Open / On Progress / Waiting / Finish counters, total WOs, pending approvals, average and total repair time, WOs per category, list with status tabs and a date range |
| **Work Order list** | Search, filters (status, approval, channel source, unit, PIC mechanic, category, date range), sortable columns, pagination, CSV export, print |
| **Approval** | WOs raised by mechanics (mobile) or WhatsApp wait for approval. Admin approves them with optional **remarks** (e.g. instructions for the mechanic, shown on the WO detail and in the mechanic app) or rejects them with a required reason. WOs created on the web are approved by the system |
| **Create / Update** | Unit (dump truck), driver, PIC mechanic, repair category, problem description, with validation and a confirmation dialog. Only one active WO is allowed per unit |
| **Detail** | Unit/driver/PIC info and a step timeline with sub-steps (PIC, start, finish, duration, remarks). Steps are started and finished in order. Additional work can be added. Printable |
| **Status logic** | `OPEN` → `ON_PROGRESS` → `WAITING` (while a *waiting step* runs, by default *Supply Spareparts*) → `FINISH` (when all steps are done), derived automatically from the steps |
| **Master Data: Units** | Add, edit, delete and deactivate units (code, number, type, brand, model, serial number, year). Shows each unit's active WO. Units with WO history can only be deactivated, and a unit with an active WO cannot be deactivated. Inactive units cannot be picked for new WOs |
| **Master Data: Employees** | Add, edit, delete and deactivate employees and give them a role. The optional **user account** section creates a login (username + password), resets the password, or removes the account. You cannot deactivate, change the role of, remove the account of, or delete your own account. Employees with WO history can only be deactivated |
| **Master Data: Roles** | Add, edit and delete roles and pick their permissions (WO create/edit/delete/approve/progress, "can be selected as driver / PIC mechanic", manage units/employees/roles/repair steps). Built-in roles keep their code and cannot be deleted. Admin always keeps every access permission. Roles in use cannot be deleted |
| **Master Data: Repair Steps** | The repair flow mechanics follow (in the mechanic app and on the web). Add, edit, reorder (move up / down), deactivate and delete steps; each step has an optional description, a sub-step checklist (up to 15, reorderable), a *waiting step* flag (the WO shows **Waiting** while it runs) and a *mechanic can add sub-steps in the app* flag (the mechanic adds sub-steps to that work order only; they are not saved to the master). Default flow (9 steps): 1 Unit Breakdown, 2 Service Request, 3 Inspection Activity, 4 Inspection Report Readiness, 5 Spareparts Request, 6 Supply Spareparts (waiting step), 7 Repair Process (mechanic sub-steps), 8 Ground Test, 9 RFU (Ready For Use). A database that still has the earlier untouched 6-step defaults is switched to these on start; an edited master is never overwritten. New work orders copy the active steps in order; existing work orders keep their own copy, so edits never change history. At least one step must stay active. Permission `master.step` (Admin has it) |
| **Mechanic web app** (`/m`) | Browser version of the mechanic app for phones, tablets and PCs (no Android needed). Tabs: *Active* (my jobs), *Available* (approved, unassigned: tap **Take job and start** to become PIC), *Requests* (my WOs waiting for approval or rejected) and *Done*. The job screen shows the current step with a live timer, the sub-step checklist, remarks and big Start / Finish buttons, plus all steps and additional work. Mechanics can raise a WO (they are preset as PIC; it goes to admin approval). Lists refresh every 30 s; an offline banner disables actions without a connection. Users who progress steps but cannot approve land here after login |
| **Installable (PWA)** | Web manifest + service worker: "Install app" in Chrome / Edge / Samsung Internet, or Share → Add to Home Screen on iPhone. It caches only the app shell, never `/api` data. Needs HTTPS (or localhost) in production |
| **App page, Profile** | Landing page for the mechanic app (Android + **Open in browser** / **Install app**, with the shareable `/m` URL); profile page with password change |
| **UX** | English / Bahasa Indonesia, light/dark theme, collapsible sidebar. Fully responsive web: on phones and tablets the tables become card lists, the menu is a slide-in drawer, dialogs open as bottom sheets and secondary buttons collapse to icons; printing still uses the full table |

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
An existing database from before the role master is migrated automatically on start (employee roles become `role_id`, units get serial number / year / active columns).

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
GET    /work-orders?search&status&approval_status&channel_source&unit_id&mechanic_id&category_id&created_by
                    &created_start&created_end&sort_by&sort_order&page&limit
GET    /work-orders/export         (CSV, same filters)
GET    /work-orders/:id            POST /work-orders          PUT /work-orders/:id     DELETE /work-orders/:id
POST   /work-orders/:id/approval   { action: APPROVE, remarks? } | { action: REJECT, reason }
POST   /work-orders/:id/steps/:stepId/start|finish   { remarks }
POST   /work-orders/:id/steps/:stepId/sub-steps      { name }   (steps with "mechanic can add sub-steps", while not finished)
POST   /work-orders/:id/additional-work              { name }
GET    /master/units?all=1  /master/employees?role=driver|mechanic  /master/roles  /master/repair-categories   (dropdown lookups)

GET/POST /units       GET/PUT/DELETE /units/:id       GET /units/types          (permission master.unit)
GET/POST /employees   GET/PUT/DELETE /employees/:id                             (permission master.employee)
GET/POST /roles       GET/PUT/DELETE /roles/:id       GET /roles/permissions    (permission master.role)
GET/POST /steps       GET/PUT/DELETE /steps/:id       POST /steps/:id/move { direction: up|down }   (permission master.step)
  step body: name, description, is_waiting, is_active, sub_steps: [names]; GET /steps returns the full ordered list
  list params: search, page, limit, sort_by, sort_order, status=active|inactive (+ unit_type, role_id, account=yes|no)
  list filters take comma lists; mechanic_id=none (or created_by=none) matches unassigned work orders
  employee body: employee fields + has_account, username, password (blank password keeps the current one)
```
