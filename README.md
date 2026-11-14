# GATHER MVP: Full Test Guide

Every step shows both **PowerShell** and **Bash** (Git Bash, macOS, Linux). Run everything from the repo root unless it says otherwise.

## 0. Prerequisites

| Need | Check | Notes |
| --- | --- | --- |
| Node.js 20+ | `node --version` | https://nodejs.org |
| Git | `git --version` | |
| A Postgres database | n/a | Pick **one** option in step 3 |

## 1. Get the code

**PowerShell**
```powershell
git clone https://github.com/pnagre05/tta-hacks.git
cd tta-hacks
git checkout gather-mvp-node
cd gather-mvp
```

**Bash**
```bash
git clone https://github.com/pnagre05/tta-hacks.git
cd tta-hacks
git checkout gather-mvp-node
cd gather-mvp
```

If you already have the repo, run `git fetch` and `git checkout gather-mvp-node` instead.

## 2. Install packages and run the logic tests (no database needed)

Same in both shells:
```
npm run setup
npm test
```

`npm test` covers the slot ranking, expense split and settle-up math (`server/test/logic.test.js`).

Optional: check that the React client builds:
```
npm run build
```

## 3. Get a Postgres database (pick one)

### Option A: Hosted Postgres on Neon (no installs, recommended)

1. Sign up at https://neon.tech and create a project.
2. Copy the connection string. It looks like `postgresql://user:pass@ep-xxxx.neon.tech/neondb?sslmode=require`.
3. Use it as `DATABASE_URL` in step 4. Skip `npm run db`.

### Option B: Docker

Install and start Docker Desktop, wait until it says it's running, then:
```
npm run db
```
The default `DATABASE_URL` in `.env.example` already matches this database.

### Option C: Local Postgres install

Install from https://www.postgresql.org/download/windows/ and remember the `postgres` user's password. Then use this in step 4:
```
postgres://postgres:<your-password>@localhost:5432/postgres
```

## 4. Create `server/.env`

**PowerShell**
```powershell
Copy-Item server\.env.example server\.env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
notepad server\.env
```

**Bash**
```bash
cp server/.env.example server/.env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
${EDITOR:-nano} server/.env
```

In `server/.env`, set:

| Variable | Value |
| --- | --- |
| `JWT_SECRET` | first generated value |
| `TOKEN_ENCRYPTION_KEY` | second generated value (must be 64 hex characters) |
| `DATABASE_URL` | your connection string from step 3 (leave the default for Docker) |

Leave `GOOGLE_*` and `ANTHROPIC_API_KEY` blank. The app works without them. Never commit `.env`.

## 5. Seed the demo data

```
npm run seed
```

This creates the demo group **Weekend Crew**. The schema is created automatically when the server starts.

## 6. Start the app

**Production-style (one port):**
```
npm start
```
Open http://localhost:4000.

**Development mode (hot reload), two terminals:**
```
npm run dev:server
```
```
npm run dev:client
```
Open http://localhost:5173.

## 7. Demo logins

| Email | Password |
| --- | --- |
| `alex@gather.test` | `password123` |
| `sam@gather.test` | `password123` |
| `priya@gather.test` | `password123` |
| `jordan@gather.test` | `password123` |
| `maya@gather.test` | `password123` |
| `chris@gather.test` | `password123` |

Invite code: `DEMO42`. In the seed data, everyone is free **Saturday 1 to 6 PM**.

## 8. Manual test checklist

Open two browsers (or one normal and one private window) and log in as two different users.

- [ ] Login works with a demo account, and a wrong password is rejected
- [ ] Schedule tab: the availability grid loads and shows Saturday 1 to 6 PM as free for everyone
- [ ] Ideas tab: add an idea as user 1. It appears **live** in user 2's window without a refresh
- [ ] Polls tab: vote as both users. Changing a vote replaces it (no double voting), and only counts are shown
- [ ] Events: a poll winner becomes a **proposed** event. Members answer Yes / Maybe / No, then it becomes **confirmed**
- [ ] Expenses tab: add an expense linked to an event. The split and settle-up amounts are correct
- [ ] The assistant answers a question (a built-in summary appears if there's no API key)

## 9. Security checks (from the project README)

In the browser, with DevTools open:

- [ ] Vote twice on a poll. The second vote replaces the first
- [ ] Add an idea named `<script>alert(1)</script>`. It shows as plain text and no alert appears
- [ ] Request `/api/groups/<some other group id>/ideas` while logged in. It returns `403`
- [ ] Fail login 20 times in 15 minutes. It gets rate limited

## 10. Stop and reset

- Stop the server with `Ctrl+C` in its terminal.
- Stop Docker Postgres (Option B only): `docker compose down`
- Re-run `npm run seed` to restore demo data.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Cannot find module` | Run `npm run setup` |
| `npm run db` fails | Docker Desktop isn't running, or use Option A |
| Port 5432 already in use | Stop your local Postgres, or point `DATABASE_URL` at it |
| Port 4000 already in use | Change `PORT` in `server/.env` and `APP_URL` to match |
| Server exits on start | Check `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` and `DATABASE_URL` in `server/.env` |
| SSL or connection error with Neon | Make sure the string ends in `?sslmode=require`, and paste the error to a maintainer |
| Login fails | Run `npm run seed` again |
| No live updates | Both browsers must use the same address and port |
| `Set-ExecutionPolicy` or script blocked (PowerShell) | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once |

## Optional features

- **Google Calendar:** see "Google Calendar setup" in `gather-mvp/README.md`. The availability grid works without it.
- **AI assistant:** set `ANTHROPIC_API_KEY` in `server/.env`. Without a key it answers from a built-in summary.
