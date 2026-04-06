# Organiser App — Setup Guide

## Prerequisites
- Node.js v18+
- A [Neon](https://neon.tech) PostgreSQL database (free tier is fine)
- A [Vercel](https://vercel.com) account (for deployment)

---

## Local Development

### 1. Install dependencies

```bash
# Root (API + Prisma)
npm install

# Frontend
cd client && npm install && cd ..
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `DATABASE_URL` — your Neon connection string
- `JWT_SECRET` — run `openssl rand -base64 48` to generate one
- `REGISTRATION_CODE` — the invite code you'll share with your partner

### 3. Push the database schema

```bash
npm run db:push
```

This creates all tables in your Neon database.

### 4. Start the dev server

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001

### 5. Register your first account

Visit http://localhost:5173/register and use your `REGISTRATION_CODE` to create an account.

---

## Deploying to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/organiser-app.git
git push -u origin main
```

### 2. Import to Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
2. Set the **Root Directory** to `/` (the repo root)
3. Add these **Environment Variables** in Vercel's dashboard:
   - `DATABASE_URL` — your Neon connection string
   - `JWT_SECRET` — your JWT secret
   - `REGISTRATION_CODE` — your invite code
4. Deploy!

### 3. Run migrations on production

After deploying, run once in your local terminal (pointing at the production DB):

```bash
DATABASE_URL="your-neon-url" npm run db:push
```

Or use Neon's dashboard to verify the tables were created.

---

## Security

### Rate limiting
Login and register endpoints are rate-limited to **10 requests per IP per 15 minutes** using `express-rate-limit`. Exceeding the limit returns a `429 Too Many Requests` response.

> **Vercel note:** The rate limiter uses an in-memory store, so counters reset per serverless function instance. It works reliably in local development and provides partial protection in production. Vercel's built-in network-layer DDoS protection handles large volumetric attacks in production.

---

### Apple Calendar / ICS feed

Each user can subscribe to a live ICS feed of their tasks (tasks with due dates only). To set it up:

1. Go to **Settings** in the app
2. Click **Get calendar link**
3. Click **Subscribe in Apple Calendar** — iOS/macOS will prompt to confirm

The feed URL uses a signed, long-lived token (1 year). Tasks appear as all-day events on their due date. Apple Calendar refreshes the feed roughly every hour; you can also pull to refresh manually.

The feed works with any ICS-compatible calendar app (Apple Calendar, Google Calendar, Outlook).

---

## API Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | No | Register (requires invite code) · rate limited |
| POST | /api/auth/login | No | Login → returns JWT · rate limited |
| PUT | /api/auth/update-password | Yes | Change password |
| GET | /api/users/me | Yes | Get own profile |
| PUT | /api/users/me | Yes | Update name/email |
| GET/POST | /api/tasks | Yes | List / create tasks |
| GET/PUT/DELETE | /api/tasks/:id | Yes | Read / update / delete task |
| GET/POST | /api/tasks/:id/updates | Yes | Notes log |
| GET/POST | /api/tasks/:id/time-logs | Yes | Time logging |
| GET/POST | /api/projects | Yes | List / create projects |
| GET/PUT/DELETE | /api/projects/:id | Yes | Manage project |
| GET/POST | /api/categories | Yes | List / create categories |
| PUT/DELETE | /api/categories/:id | Yes | Manage category |
| GET | /api/calendar/token | Yes | Generate a calendar feed token |
| GET | /api/calendar/feed?token= | No* | ICS feed for calendar apps |

*The calendar feed uses a signed token in the query string instead of a Bearer header, as calendar apps cannot send custom headers.
