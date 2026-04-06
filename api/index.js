import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'

// ── Prisma ────────────────────────────────────────────────────────────────────
const prisma = global.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') global.prisma = prisma

// ── Auth helpers ──────────────────────────────────────────────────────────────
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ── Task shape helper ─────────────────────────────────────────────────────────
function shapeTask(task) {
  return {
    ...task,
    projects: task.projects.map(tp => tp.project),
    categories: task.categories.map(tc => tc.category),
  }
}

const taskInclude = {
  owner: { select: { id: true, name: true } },
  projects: { include: { project: { select: { id: true, name: true, color: true } } } },
  categories: { include: { category: { select: { id: true, name: true, color: true } } } },
  _count: { select: { updates: true, timeLogs: true } },
}

async function getAccessibleTask(id, userId) {
  return prisma.task.findFirst({
    where: { id, OR: [{ ownerId: userId }, { isShared: true }] },
    include: taskInclude,
  })
}

async function getAccessibleProject(id, userId) {
  return prisma.project.findFirst({
    where: { id, OR: [{ ownerId: userId }, { isShared: true }] },
    include: { owner: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
  })
}

async function getAccessibleCategory(id, userId) {
  return prisma.category.findFirst({
    where: { id, OR: [{ ownerId: userId }, { isShared: true }] },
    include: { owner: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
  })
}

// ── App ───────────────────────────────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Limits brute-force attempts on public auth endpoints.
// Note: uses an in-memory store — effective locally and per-instance on Vercel.
// Vercel's network-layer DDoS protection covers volumetric attacks in production.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again in 15 minutes' },
})

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, registrationCode } = req.body
    if (!name || !email || !password || !registrationCode)
      return res.status(400).json({ error: 'name, email, password, and registrationCode are required' })
    if (registrationCode !== process.env.REGISTRATION_CODE)
      return res.status(403).json({ error: 'Invalid registration code' })
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing)
      return res.status(409).json({ error: 'An account with that email already exists' })
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true, createdAt: true },
    })
    const token = signToken({ userId: user.id, email: user.email, name: user.name })
    return res.status(201).json({ user, token })
  } catch (err) {
    console.error('[register]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password)
      return res.status(400).json({ error: 'email and password are required' })
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Invalid email or password' })
    const token = signToken({ userId: user.id, email: user.email, name: user.name })
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt } })
  } catch (err) {
    console.error('[login]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.put('/api/auth/update-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'currentPassword and newPassword are required' })
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters' })
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } })
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!(await bcrypt.compare(currentPassword, user.passwordHash)))
      return res.status(401).json({ error: 'Current password is incorrect' })
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } })
    return res.json({ message: 'Password updated successfully' })
  } catch (err) {
    console.error('[update-password]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── USERS ─────────────────────────────────────────────────────────────────────

app.get('/api/users/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, name: true, email: true, createdAt: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    return res.json(user)
  } catch (err) {
    console.error('[GET /users/me]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.put('/api/users/me', requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body
    if (email) {
      const existing = await prisma.user.findFirst({ where: { email, NOT: { id: req.user.userId } } })
      if (existing) return res.status(409).json({ error: 'Email already in use' })
    }
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { ...(name !== undefined && { name }), ...(email !== undefined && { email }) },
      select: { id: true, name: true, email: true, createdAt: true },
    })
    return res.json(user)
  } catch (err) {
    console.error('[PUT /users/me]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── TASKS ─────────────────────────────────────────────────────────────────────

app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const { status, priority, projectId, categoryId, shared } = req.query
    const userId = req.user.userId
    const where = {
      OR: [{ ownerId: userId }, { isShared: true }],
      ...(status && { status }),
      ...(priority && { priority }),
      ...(projectId && { projects: { some: { projectId } } }),
      ...(categoryId && { categories: { some: { categoryId } } }),
      ...(shared === 'true' && { isShared: true }),
      ...(shared === 'false' && { ownerId: userId, isShared: false }),
    }
    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      include: taskInclude,
    })
    return res.json(tasks.map(shapeTask))
  } catch (err) {
    console.error('[GET /tasks]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const { title, description, status, priority, dueDate, isShared, projectIds, categoryIds } = req.body
    if (!title) return res.status(400).json({ error: 'title is required' })
    const task = await prisma.task.create({
      data: {
        title, description,
        status: status || 'TODO',
        priority: priority || 'MEDIUM',
        dueDate: dueDate ? new Date(dueDate) : null,
        isShared: isShared ?? false,
        ownerId: req.user.userId,
        projects: projectIds?.length ? { create: projectIds.map(projectId => ({ projectId })) } : undefined,
        categories: categoryIds?.length ? { create: categoryIds.map(categoryId => ({ categoryId })) } : undefined,
      },
      include: taskInclude,
    })
    return res.status(201).json(shapeTask(task))
  } catch (err) {
    console.error('[POST /tasks]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await getAccessibleTask(req.params.id, req.user.userId)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    return res.json(shapeTask(task))
  } catch (err) {
    console.error('[GET /tasks/:id]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await getAccessibleTask(req.params.id, req.user.userId)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (task.ownerId !== req.user.userId)
      return res.status(403).json({ error: 'Only the task owner can edit this task' })
    const { title, description, status, priority, dueDate, isShared, projectIds, categoryIds } = req.body
    const updated = await prisma.$transaction(async (tx) => {
      if (projectIds !== undefined) await tx.taskProject.deleteMany({ where: { taskId: task.id } })
      if (categoryIds !== undefined) await tx.taskCategory.deleteMany({ where: { taskId: task.id } })
      return tx.task.update({
        where: { id: task.id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(status !== undefined && { status }),
          ...(priority !== undefined && { priority }),
          ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
          ...(isShared !== undefined && { isShared }),
          ...(projectIds?.length && { projects: { create: projectIds.map(projectId => ({ projectId })) } }),
          ...(categoryIds?.length && { categories: { create: categoryIds.map(categoryId => ({ categoryId })) } }),
        },
        include: taskInclude,
      })
    })
    return res.json(shapeTask(updated))
  } catch (err) {
    console.error('[PUT /tasks/:id]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await getAccessibleTask(req.params.id, req.user.userId)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (task.ownerId !== req.user.userId)
      return res.status(403).json({ error: 'Only the task owner can delete this task' })
    await prisma.task.delete({ where: { id: task.id } })
    return res.json({ message: 'Task deleted' })
  } catch (err) {
    console.error('[DELETE /tasks/:id]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/tasks/:id/updates', requireAuth, async (req, res) => {
  try {
    const task = await getAccessibleTask(req.params.id, req.user.userId)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    const updates = await prisma.taskUpdate.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    })
    return res.json(updates)
  } catch (err) {
    console.error('[GET /tasks/:id/updates]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/tasks/:id/updates', requireAuth, async (req, res) => {
  try {
    const task = await getAccessibleTask(req.params.id, req.user.userId)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    const { content } = req.body
    if (!content) return res.status(400).json({ error: 'content is required' })
    const update = await prisma.taskUpdate.create({
      data: { content, taskId: task.id, userId: req.user.userId },
      include: { user: { select: { id: true, name: true } } },
    })
    return res.status(201).json(update)
  } catch (err) {
    console.error('[POST /tasks/:id/updates]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/tasks/:id/time-logs', requireAuth, async (req, res) => {
  try {
    const task = await getAccessibleTask(req.params.id, req.user.userId)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    const logs = await prisma.timeLog.findMany({
      where: { taskId: task.id },
      orderBy: { loggedAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    })
    const totalMinutes = logs.reduce((sum, l) => sum + l.durationMinutes, 0)
    return res.json({ logs, totalMinutes })
  } catch (err) {
    console.error('[GET /tasks/:id/time-logs]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/tasks/:id/time-logs', requireAuth, async (req, res) => {
  try {
    const task = await getAccessibleTask(req.params.id, req.user.userId)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    const { durationMinutes, description, loggedAt } = req.body
    if (!durationMinutes || durationMinutes <= 0)
      return res.status(400).json({ error: 'durationMinutes must be a positive number' })
    const log = await prisma.timeLog.create({
      data: {
        durationMinutes: parseInt(durationMinutes),
        description,
        loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
        taskId: task.id,
        userId: req.user.userId,
      },
      include: { user: { select: { id: true, name: true } } },
    })
    return res.status(201).json(log)
  } catch (err) {
    console.error('[POST /tasks/:id/time-logs]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── PROJECTS ──────────────────────────────────────────────────────────────────

app.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: { OR: [{ ownerId: req.user.userId }, { isShared: true }] },
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
    })
    return res.json(projects)
  } catch (err) {
    console.error('[GET /projects]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const { name, description, color, isShared } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const project = await prisma.project.create({
      data: { name, description, color: color || '#6366f1', isShared: isShared ?? false, ownerId: req.user.userId },
      include: { owner: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
    })
    return res.status(201).json(project)
  } catch (err) {
    console.error('[POST /projects]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.put('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await getAccessibleProject(req.params.id, req.user.userId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    if (project.ownerId !== req.user.userId)
      return res.status(403).json({ error: 'Only the project owner can edit this project' })
    const { name, description, color, isShared } = req.body
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(isShared !== undefined && { isShared }),
      },
      include: { owner: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
    })
    return res.json(updated)
  } catch (err) {
    console.error('[PUT /projects/:id]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await getAccessibleProject(req.params.id, req.user.userId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    if (project.ownerId !== req.user.userId)
      return res.status(403).json({ error: 'Only the project owner can delete this project' })
    await prisma.project.delete({ where: { id: project.id } })
    return res.json({ message: 'Project deleted' })
  } catch (err) {
    console.error('[DELETE /projects/:id]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── CATEGORIES ────────────────────────────────────────────────────────────────

app.get('/api/categories', requireAuth, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { OR: [{ ownerId: req.user.userId }, { isShared: true }] },
      orderBy: { name: 'asc' },
      include: { owner: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
    })
    return res.json(categories)
  } catch (err) {
    console.error('[GET /categories]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/categories', requireAuth, async (req, res) => {
  try {
    const { name, color, isShared } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const category = await prisma.category.create({
      data: { name, color: color || '#f59e0b', isShared: isShared ?? false, ownerId: req.user.userId },
      include: { owner: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
    })
    return res.status(201).json(category)
  } catch (err) {
    console.error('[POST /categories]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.put('/api/categories/:id', requireAuth, async (req, res) => {
  try {
    const category = await getAccessibleCategory(req.params.id, req.user.userId)
    if (!category) return res.status(404).json({ error: 'Category not found' })
    if (category.ownerId !== req.user.userId)
      return res.status(403).json({ error: 'Only the category owner can edit it' })
    const { name, color, isShared } = req.body
    const updated = await prisma.category.update({
      where: { id: category.id },
      data: {
        ...(name !== undefined && { name }),
        ...(color !== undefined && { color }),
        ...(isShared !== undefined && { isShared }),
      },
      include: { owner: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
    })
    return res.json(updated)
  } catch (err) {
    console.error('[PUT /categories/:id]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.delete('/api/categories/:id', requireAuth, async (req, res) => {
  try {
    const category = await getAccessibleCategory(req.params.id, req.user.userId)
    if (!category) return res.status(404).json({ error: 'Category not found' })
    if (category.ownerId !== req.user.userId)
      return res.status(403).json({ error: 'Only the category owner can delete it' })
    await prisma.category.delete({ where: { id: category.id } })
    return res.json({ message: 'Category deleted' })
  } catch (err) {
    console.error('[DELETE /categories/:id]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── CALENDAR ──────────────────────────────────────────────────────────────────

// Returns a long-lived calendar token (signed JWT, 1 year, calendar purpose only)
app.get('/api/calendar/token', requireAuth, (req, res) => {
  const token = jwt.sign(
    { userId: req.user.userId, purpose: 'calendar' },
    process.env.JWT_SECRET,
    { expiresIn: '1y' }
  )
  return res.json({ token })
})

// ICS feed — authenticated via ?token= query param (calendar apps can't send headers)
app.get('/api/calendar/feed', async (req, res) => {
  const { token } = req.query
  if (!token) return res.status(401).send('Missing token')

  let userId
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.purpose !== 'calendar') throw new Error('wrong purpose')
    userId = payload.userId
  } catch {
    return res.status(401).send('Invalid or expired token')
  }

  try {
    const tasks = await prisma.task.findMany({
      where: { OR: [{ ownerId: userId }, { isShared: true }], dueDate: { not: null } },
      select: { id: true, title: true, description: true, status: true, dueDate: true },
      orderBy: { dueDate: 'asc' },
    })

    const STATUS_MAP = { TODO: 'NEEDS-ACTION', IN_PROGRESS: 'IN-PROCESS', DONE: 'COMPLETED' }

    function icsDate(date) {
      return new Date(date).toISOString().slice(0, 10).replace(/-/g, '')
    }

    function icsNow() {
      return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'
    }

    function escapeIcs(str) {
      return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
    }

    const stamp = icsNow()

    const events = tasks.map(task => {
      const start = icsDate(task.dueDate)
      const endDate = new Date(task.dueDate)
      endDate.setUTCDate(endDate.getUTCDate() + 1)
      const end = icsDate(endDate)

      return [
        'BEGIN:VEVENT',
        `UID:task-${task.id}@organiser-app`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${escapeIcs(task.title)}`,
        task.description ? `DESCRIPTION:${escapeIcs(task.description)}` : null,
        `STATUS:${STATUS_MAP[task.status] || 'NEEDS-ACTION'}`,
        'END:VEVENT',
      ].filter(Boolean).join('\r\n')
    })

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Organiser App//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:My Tasks',
      'X-WR-CALDESC:Tasks with due dates from Organiser App',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n')

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', 'inline; filename="tasks.ics"')
    return res.send(ics)
  } catch (err) {
    console.error('[GET /calendar/feed]', err)
    return res.status(500).send('Internal server error')
  }
})

export default app
