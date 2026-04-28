import express from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../lib/auth.js'

const router = express.Router()
router.use(requireAuth)

// ── Include helpers ───────────────────────────────────────────────────────────
const cardInclude = {
  balanceTransfers: true
}

// ── Debt Cards ────────────────────────────────────────────────────────────────

router.get('/cards', async (req, res) => {
  try {
    const cards = await prisma.debtCard.findMany({
      where: { ownerId: req.user.userId },
      include: cardInclude,
      orderBy: { createdAt: 'desc' }
    })
    res.json(cards)
  } catch (err) {
    console.error('[GET /debt/cards]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/cards', async (req, res) => {
  try {
    const { name, totalDebt, apr, monthlyPayment, balanceTransfers = [] } = req.body
    
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })

    const card = await prisma.$transaction(async (tx) => {
      const created = await tx.debtCard.create({
        data: {
          name: name.trim(),
          totalDebt: Number(totalDebt) || 0,
          apr: Number(apr) || 0,
          monthlyPayment: Number(monthlyPayment) || 0,
          ownerId: req.user.userId,
          balanceTransfers: {
            create: balanceTransfers.map(bt => ({
              amount: Number(bt.amount) || 0,
              expiresInMonths: Number(bt.expiresInMonths) || 0
            }))
          }
        },
        include: cardInclude
      })
      return created
    })
    
    res.status(201).json(card)
  } catch (err) {
    console.error('[POST /debt/cards]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/cards/:id', async (req, res) => {
  try {
    const { name, totalDebt, apr, monthlyPayment, balanceTransfers = [] } = req.body
    
    const existing = await prisma.debtCard.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' })

    const updated = await prisma.$transaction(async (tx) => {
      // Replace existing transfers
      await tx.balanceTransfer.deleteMany({ where: { cardId: req.params.id } })
      
      return tx.debtCard.update({
        where: { id: req.params.id },
        data: {
          ...(name && { name: name.trim() }),
          ...(totalDebt !== undefined && { totalDebt: Number(totalDebt) }),
          ...(apr !== undefined && { apr: Number(apr) }),
          ...(monthlyPayment !== undefined && { monthlyPayment: Number(monthlyPayment) }),
          balanceTransfers: {
            create: balanceTransfers.map(bt => ({
              amount: Number(bt.amount) || 0,
              expiresInMonths: Number(bt.expiresInMonths) || 0
            }))
          }
        },
        include: cardInclude
      })
    })

    res.json(updated)
  } catch (err) {
    console.error('[PUT /debt/cards/:id]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/cards/:id', async (req, res) => {
  try {
    const existing = await prisma.debtCard.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' })
    
    await prisma.debtCard.delete({ where: { id: req.params.id } })
    res.json({ message: 'Card deleted' })
  } catch (err) {
    console.error('[DELETE /debt/cards/:id]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
