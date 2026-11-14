# GATHER

A private app where a friend group (5–10 people) finds a time everyone is free, picks what to do,
and splits the bill. Everyone's phone updates live.

**Stack:** React + Vite (fonts bundled, so the design works offline) · Node.js + Express 5 · Socket.IO · PostgreSQL · Google Calendar API (free/busy only) · optional LLM

## Run it (about 5 minutes)

Needs Node 20+. No Docker, no database install, no accounts, no `.env`.

```bash
npm run setup                  # install root, server and client packages (once)
npm run dev                    # starts the server and the client together
```

Open `http://localhost:5173`. The first start creates a local database in `server/data/` and loads the
demo group "Weekend Crew" automatically.

Other ways to run:

- **One port (demo / phones on Wi-Fi):** `npm start`. This builds the React app and serves everything from
  one port. The server prints a `http://192.168.x.x:4000` address; open it on any phone on the same Wi-Fi.
- **Two terminals:** `npm run dev:server` and `npm run dev:client`.
- **Reset the data:** `npm run reset`, then start again (it re-seeds).
- **Re-seed manually:** `npm run seed`.

The database is PGlite (real Postgres running inside Node), so the SQL is standard Postgres. To use a
separate server such as Neon or Docker later, swap the implementation in `server/src/db.js`.

**Demo logins:** `alex@gather.test`, `sam@gather.test`, `priya@gather.test`, `jordan@gather.test`,
`maya@gather.test`, `chris@gather.test`. Password for all: `password123`. Invite code: `DEMO42`.
In the seeded data, everyone is free Saturday 1–6 PM.

Run `npm test` for the logic tests: the slot ranking, expense split, and settle-up math.

## Google Calendar

Removed from the local build to keep it simple. Availability is entered by hand in the Schedule tab's grid.
The Google integration (OAuth, free/busy sync, encrypted refresh tokens) can be re-added from git history.

## GATHER AI

Set `ANTHROPIC_API_KEY` in `server/.env` to get natural-language answers. Without a key, the assistant still
answers from the same data with a built-in summary, so the demo never depends on the internet.
To use another LLM, change `askModel()` in `server/src/routes/ai.js`.

## How it fits together

```
phone/laptop (React) ── REST /api/* ──► Express ──► PostgreSQL
        ▲                                  │
        └──── Socket.IO "group:updated" ◄──┘   (after every successful write)
```

- The server is the only source of truth. After any write, it emits `group:updated` with a type
  (`availability`, `event`, `poll`, `idea`, `expense`) to that group's room. Screens showing that type refetch.
  Hook: `useGroupData(path, types)` in `client/src/live.js`.
- Flow: availability → ranked slots → Idea Bank → poll → winner becomes a **proposed** event →
  members answer Yes / Maybe / No → **confirmed** → expenses link to the event → AI answers from all of it.

| Folder | What's in it |
| --- | --- |
| `server/src/routes/` | One file per feature: `auth`, `groups`, `calendar`, `availability` (incl. slots), `events`, `ideas`, `polls`, `expenses`, `ai` |
| `server/src/lib/` | Pure logic: `slots.js` (ranking), `settle.js` (splits + fewest payments), `time.js` (time zones) |
| `server/src/schema.sql` | Every table; runs automatically on start |
| `client/src/pages/` | One file per tab |
| `client/src/components/` | `AvailabilityGrid`, `CalendarConnect`, `EventCard` |

## Security measures (each one can be demoed live)

| Threat | What GATHER does |
| --- | --- |
| Stolen passwords | bcrypt hashes (cost 12); login errors never reveal which emails exist; 20 failed attempts per 15 min |
| Stolen sessions | Session token in an `httpOnly`, `SameSite=Lax` cookie: page scripts can't read it, other sites can't send it |
| Seeing another group's data | Every route and socket room checks group membership → `403` |
| Double voting | `PRIMARY KEY (poll_id, user_id)` in the database; changing a vote replaces it |
| Revealing who voted for what | The API only ever returns vote counts |
| Fake or broken expenses | Server checks every person is in the group and computes splits itself; amounts are integer cents |
| Calendar privacy | Free/busy-only scope; refresh tokens encrypted with AES-256-GCM; one-time OAuth `state` (CSRF) |
| Script injection | zod validation on every input; React escapes all text (try an idea named `<script>alert(1)</script>`) |
| Flooding | Rate limits on the API (300/min), login, AI (10/min), and socket messages (20 per 10 s) |
| AI leaking data | The AI only receives data the server loads for the logged-in member's own group |
| Misc | `helmet` security headers; JSON body limit of 100 KB; secrets live only in `server/.env` |

**Live attack demo:** log in, open DevTools, and try to (1) vote twice, (2) fetch `/api/groups/<other id>/ideas`,
and (3) add a script-tag idea. All three fail.
