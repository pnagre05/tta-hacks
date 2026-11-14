# GATHER

A private app where a friend group (5–10 people) finds a time everyone is free, picks what to do,
and splits the bill. Everyone's phone updates live.

**Stack:** React + Vite (fonts bundled, so the design works offline) · Node.js + Express 5 · Socket.IO · PostgreSQL · Google Calendar API (free/busy only) · optional LLM

## Run it (about 5 minutes)

Needs Node 20+ and Docker.

```bash
npm run setup                  # install server + client packages
npm run db                     # start Postgres in Docker (port 5432)
cp server/.env.example server/.env
# edit server/.env: set JWT_SECRET and TOKEN_ENCRYPTION_KEY (command is in the file)
npm run seed                   # demo group "Weekend Crew"
```

Then pick one:

- **Demo / phones on Wi-Fi:** `npm start`. This builds the React app and serves everything from one port.
  The server prints a `http://192.168.x.x:4000` address; open it on any phone on the same Wi-Fi.
- **Developing:** run `npm run dev:server` and `npm run dev:client` in two terminals, then open
  `http://localhost:5173` (phones: the `Network:` address Vite prints). Code changes reload automatically.

**Demo logins:** `alex@gather.test`, `sam@gather.test`, `priya@gather.test`, `jordan@gather.test`,
`maya@gather.test`, `chris@gather.test`. Password for all: `password123`. Invite code: `DEMO42`.
In the seeded data, everyone is free Saturday 1–6 PM.

Run `npm test` for the logic tests: the slot ranking, expense split, and settle-up math.

## Google Calendar setup

Google only sends people back to `https` or `localhost` addresses after sign-in, never to a LAN IP.
So the sign-in callback goes through a free HTTPS tunnel.

1. At console.cloud.google.com, create a project and enable the **Google Calendar API**.
2. Set up the OAuth consent screen: **External**, left in **Testing** mode. Add every friend's Gmail as a **test user**.
3. Run a tunnel to the server: `ngrok http 4000` (or `cloudflared tunnel --url http://localhost:4000`).
4. Create an OAuth client (type **Web application**). Add the authorized redirect URI
   `https://<tunnel-address>/api/calendar/callback`.
5. In `server/.env`, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` (the same URI as step 4).
   Set `APP_URL` to the address people open the app on, e.g. `http://192.168.1.20:4000`. Restart the server.

Members then tap **Connect Google Calendar** on the Schedule tab. The scope requested is only
`calendar.events.freebusy`. GATHER stores busy start and end times, never event names. **Disconnect**
revokes Google's access and deletes those times. Without Google set up, the availability grid works fully offline.

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
