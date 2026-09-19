# VS Code Stack + Parallel Agent Setup — Gurukrupa Eye Hospital System

Scope: the core tool only (Queue, Machines/OCR, OT, Prescription+Inventory, Admin/Login, Appointments, MR Visits) — matches `proposal-core-tool.pdf`. WhatsApp automations are Phase 2, not part of this build.

---

## 1. Full stack

### Backend
| Tool | Role |
|---|---|
| **Python 3.11+** | Language |
| **FastAPI** | Web framework — API endpoints |
| **Uvicorn** | ASGI server that actually runs FastAPI |
| **PostgreSQL 15+** | Database |
| **SQLAlchemy** | ORM — Python objects instead of raw SQL |
| **Alembic** | Database migrations — versioned schema changes |
| **Tesseract + pytesseract** | OCR engine — runs server-side, exactly as decided (phone just uploads a photo, the server does the reading) |
| **Pillow / OpenCV** | Image preprocessing before OCR — deskew, crop to the machine's known field position, contrast fix. This is the real engineering work behind "reading a photo," not Tesseract itself |
| **passlib (bcrypt)** | Real password hashing — replaces the mockup's plaintext demo passwords |
| **python-jose** | Session tokens (JWT) — replaces the mockup's `currentUser` JS variable with something that survives a page reload and can't be faked client-side |
| **python-multipart** | Handles the actual photo file uploads |
| **python-dotenv** | Environment variables — DB connection string, secret keys, kept out of the code itself |

### Frontend
| Tool | Role |
|---|---|
| **React + Vite** | UI framework + fast build tool |
| **React Router** | Navigation between screens (Queue, Machines, OT, etc.) |
| **vite-plugin-pwa** | Makes it installable and enables the offline photo-queue — this is what actually implements "save locally, upload when back online" for real, not just simulated |
| **idb** (IndexedDB wrapper) | Where those offline-queued photos actually live on the device until they upload |
| **Axios** (or plain fetch) | Talking to the FastAPI backend |

### Database & local dev
| Tool | Role |
|---|---|
| **Docker** (optional but recommended) | Run PostgreSQL locally with one command, without a manual install — also lets your local setup match the Hostinger VPS environment |
| **pgAdmin** or **DBeaver** | GUI for looking at the database while developing |

### Testing
| Tool | Role |
|---|---|
| **pytest** | Backend tests |
| **Vitest** | Frontend tests (pairs naturally with Vite) |

### Deployment (Hostinger VPS, Mumbai — already decided)
| Tool | Role |
|---|---|
| **Ubuntu** | The VPS's own OS |
| **Nginx** | Reverse proxy — serves the built React app and routes API calls to FastAPI |
| **Certbot / Let's Encrypt** | Free SSL — the "₹0, included" line from the monthly costs |
| **systemd** | Keeps the FastAPI process running permanently, restarts it if it crashes |
| **Git** | Deploying is `git pull` + restart on the VPS, not manual file copying |

### VS Code itself
| Tool | Role |
|---|---|
| **Node.js LTS (20.x)** | Needed to run the frontend build tooling, and Claude Code itself |
| **Claude Code extension** (or CLI: `npm install -g @anthropic-ai/claude-code`) | The actual coding agent |
| **Python extension** (Microsoft) | Backend editing/debugging |
| **ESLint + Prettier** | Consistent code formatting |
| **GitLens** | See history/blame inline — useful once 4 agents' branches start merging |
| **Thunder Client** or **REST Client** extension | Test API endpoints directly inside VS Code, without leaving it for Postman |

---

## 2. Project structure

```
gurukrupa-system/
  backend/              FastAPI + PostgreSQL
    app/
      models/           DB schema (patients, readings, medicines, inventory, staff, roles…)
      routes/           API endpoints, one file per module (queue, machines, ot, prescriptions, admin…)
      auth/             Login + role-based permission checks
      ocr/              Tesseract + image preprocessing, one file per machine template
    alembic/             Migration history
    requirements.txt
  frontend/             React PWA
    src/
      screens/          One folder per screen: Queue, Machines, OT, Appointments, MRs, Inventory, Admin, Login
      components/       Shared UI pieces
      offline/           IndexedDB queue logic
    vite.config.js
  docs/
    mockup-reference.html    <- copy of the working mockup, kept as the source of truth
    proposal-core-tool.pdf
```

**Why keep the mockup in `docs/`:** it already encodes every real decision made during design — the OCR field mappings, the offline-queue logic, the treatment-plan/inventory split, the role-permission model, the day-based (no time slots) booking logic. Point every agent at it before it writes code for that area, rather than re-deriving the logic from scratch or from memory.

---

## 3. Set up 4 parallel workspaces with git worktrees

A single repo, one branch and folder per agent, so four Claude Code sessions can run at once without stepping on each other's files.

```bash
cd gurukrupa-system
git init
git commit --allow-empty -m "init"

git worktree add ../gurukrupa-agent1-backend -b agent1-backend
git worktree add ../gurukrupa-agent2-queue -b agent2-queue
git worktree add ../gurukrupa-agent3-ot-machines -b agent3-ot-machines
git worktree add ../gurukrupa-agent4-admin-rx -b agent4-admin-rx
```

Open each folder as its **own VS Code window**, run Claude Code in each one independently. They share git history but never touch each other's working files while running.

---

## 4. The actual task split

**Agent 1 — Backend foundation.** Start this one first, or at minimum a few hours ahead of the others — everyone else needs its API shape to build against.
- Database schema: patients, readings, medicines/inventory, appointments, OT cases, staff/roles
- Auth endpoints: login, session handling (real JWT + bcrypt, not the mockup's plaintext), permission checks per role
- Core CRUD endpoints for patients and the queue

**Agent 2 — Queue, Appointments, Dilation Protocol.**
- Patient queue screen (stages, mobile card view, waiting-time tracking)
- Appointments (day-based, no time slots)
- Dilation protocol (admin-configurable sequence, auto-advancing timer)

**Agent 3 — Machines (OCR) + OT/Surgery.**
- Machines screen: patient-then-machine picker, mobile-only capture, real offline queue (IndexedDB + PWA background sync), async upload-then-process
- Image preprocessing pipeline (deskew/crop/contrast) + Tesseract, per machine template
- OT: real time-slot calendar, pre-op biometry, operative details, consent, post-op, surgical billing

**Agent 4 — Prescription + Inventory, Admin + Login UI, MR Visits.**
- Prescription: treatment plan vs. quantity-given split, inventory linkage, Hinglish/Gujlish print output
- Admin: staff/roles management UI, stages/protocol/referral config
- Login screen, MR visit log + rep history

**Realistic dependency note:** Agents 2–4 can build their UI and component logic immediately against the data shapes already defined in the mockup, without waiting on Agent 1 — but wiring real API calls (instead of mock data) has to happen once Agent 1's endpoints exist. Plan a short integration pass after the first backend endpoints land, not a single big merge at the very end.

---

## 5. How to brief each agent

For each worktree, before writing code, tell Claude Code to read `docs/mockup-reference.html` and find the relevant section (e.g., "read the `captureMachineTest` and offline-queue logic before building the Machines screen"). This keeps the real build faithful to everything already decided, instead of re-inventing it.

---

## 6. Merging back

Merge Agent 1 (backend) into `main` first, since 2–4 depend on its shape. Then merge 2, 3, and 4 in any order — they touch different screens/files and shouldn't conflict with each other, only occasionally with shared files like the main navigation/routing setup, which is worth a quick manual check on each merge.
