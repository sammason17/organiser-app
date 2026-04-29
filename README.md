# My Life

A personal life organiser built with React, Node/Express, and PostgreSQL (Neon). Manage tasks, track time, plan workouts, and subscribe to a live calendar feed, all in one place. Deploy your own instance, set a registration code, and share it with whoever you want. Tasks and categories are private by default and can be selectively shared between users.

## Stack

- **Frontend** — React + Vite + Tailwind CSS
- **Backend** — Express (Vercel Serverless Functions)
- **Database** — PostgreSQL via [Neon](https://neon.tech)
- **ORM** — Prisma
- **Auth** — JWT access tokens + bcrypt

## Features

### Tasks
- Private tasks with status (To Do / In Progress / Done), priority, due dates, and multi-category assignment
- Shared tasks and categories visible across both users
- Per-task notes log — append-only updates with timestamps and author
- Time logging per task with running totals
- Board and list views with filtering by status, priority, and category
- Invite-code-protected registration

### Calendar
- Subscribe to a live ICS feed of tasks with due dates in Apple Calendar, Google Calendar, or any ICS-compatible app
- Feed token generated from Settings, valid for 1 year

### Workout Planner
- **Exercise Library** — create exercises with name, YouTube/Vimeo video embed, categories (Strength, Cardio, etc.), and body areas (Chest, Back, etc.)
- **Plan Builder** — multi-step wizard: name your plan, set days per week, configure each day (Upper/Lower/Full Body/Cardio/Rest) and assign exercises with target sets/reps/weight
- **Active Workout** — work through exercises sequentially; view last session values as reference; enter actual sets/reps/weight; rest timer (with audio beep) between exercises
- Last-session values stored per exercise — no history bloat

### Debt Calculator
- Add and manage credit cards and loans with total balances, APR, and monthly payments
- View portfolio-level summaries including combined debt, interest liability, and total monthly payments
- Track promotional 0% balance transfers, including exact expiration dates and post-offer payment increases
- Set specific monthly payment dates for accurate, date-based payoff simulations
- Edit existing debt entries to accommodate variable interest rates and changing terms
- All debt data is private and strictly scoped to the authenticated user

## Local Development

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Copy env file and fill in values
cp .env.example .env

# Push schema to database
npm run db:push

# Start dev server
npm run dev
```

Frontend runs at `http://localhost:5173`, API at `http://localhost:3001`.

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | Long random secret for signing tokens |
| `JWT_EXPIRES_IN` | Token expiry e.g. `7d` |
| `REGISTRATION_CODE` | Invite code required to register |

## Deploying to Vercel

1. Push to GitHub
2. Import the repo in Vercel — set root directory to `/`
3. Add the environment variables above in Vercel's project settings
4. Deploy

## API Overview

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register with invite code |
| POST | `/api/auth/login` | Login → JWT token |
| PUT | `/api/auth/update-password` | Change password |
| GET/PUT | `/api/users/me` | View / update profile |

### Tasks & Categories
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/tasks` | List (filterable) / create tasks |
| GET/PUT/DELETE | `/api/tasks/:id` | Manage a task |
| POST | `/api/tasks/:id/updates` | Add a note to a task |
| POST | `/api/tasks/:id/time-logs` | Log time on a task |
| GET/POST | `/api/categories` | List / create categories |
| PUT/DELETE | `/api/categories/:id` | Manage a category |

### Calendar
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/calendar/token` | Generate calendar feed token |
| GET | `/api/calendar/feed?token=` | ICS feed for calendar apps |

### Workout Planner
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/workout/exercise-categories` | List / create exercise categories |
| PUT/DELETE | `/api/workout/exercise-categories/:id` | Manage a category |
| GET/POST | `/api/workout/body-areas` | List / create body areas |
| PUT/DELETE | `/api/workout/body-areas/:id` | Manage a body area |
| GET/POST | `/api/workout/exercises` | List / create exercises |
| GET/PUT/DELETE | `/api/workout/exercises/:id` | Manage an exercise |
| GET/POST | `/api/workout/plans` | List / create workout plans |
| GET/PUT/DELETE | `/api/workout/plans/:id` | Manage a plan |
| PATCH | `/api/workout/plans/:id/activate` | Set as active plan |
| PATCH | `/api/workout/day-exercises/:id/complete` | Record exercise completion (saves last sets/reps/weight) |

### Debt Calculator
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/debt/cards` | List / create debt cards (with balance transfers) |
| PUT/DELETE | `/api/debt/cards/:id` | Manage a debt card |

All endpoints except register, login, and the calendar feed require an `Authorization: Bearer <token>` header.
