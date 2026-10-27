const prisma = require('../prismaConnection')
const { AppError } = require('../middleware/errorHandler')

const toAccount = (a) => ({
  id: a.id,
  name: a.name,
  balance: a.balance,
  created_at: a.createdAt,
})

const toTransaction = (t) => ({
  id: t.id,
  account_id: t.accountId,
  type: t.type,
  amount: t.amount,
  description: t.description,
  reference_id: t.referenceId,
  created_at: t.createdAt,
})

const findAccount = async (id) => {
  const account = await prisma.account.findUnique({ where: { id } })
  if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found')
  return account
}

const insufficient = () =>
  new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit')

// the where clause makes the balance check and the update a single statement,
// so two debits at the same time can't both pass
const debit = async (tx, accountId, amount) => {
  const res = await tx.account.updateMany({
    where: { id: accountId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  })
  if (res.count === 0) throw insufficient()
}

const credit = (tx, accountId, amount) =>
  tx.account.update({ where: { id: accountId }, data: { balance: { increment: amount } } })

const duplicate = async (accountId, referenceId) => {
  const existing = await prisma.transaction.findUnique({
    where: { accountId_referenceId: { accountId, referenceId } },
  })
  return new AppError(409, 'DUPLICATE_TRANSACTION', 'A transaction with this reference_id already exists', {
    transaction: existing && toTransaction(existing),
  })
}

const isUniqueViolation = (err) => err && err.code === 'P2002'


const createAccount = async (req, res) => {
  const account = await prisma.account.create({ data: { name: req.body.name.trim() } })
  res.status(201).json(toAccount(account))
}

const listAccounts = async (req, res) => {
  const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'desc' } })
  res.json({ data: accounts.map(toAccount) })
}

const getBalance = async (req, res) => {
  const account = await findAccount(req.params.id)
  res.json({ account_id: account.id, balance: account.balance })
}

const addTransaction = async (req, res) => {
  const accountId = req.params.id
  const { type, amount, description = '' } = req.body
  const referenceId = req.body.reference_id.trim()

  await findAccount(accountId)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: { accountId, type, amount, description, referenceId },
      })
      if (type === 'debit') await debit(tx, accountId, amount)
      else await credit(tx, accountId, amount)

      const account = await tx.account.findUnique({ where: { id: accountId } })
      return { txn, account }
    })

    res.status(201).json({
      transaction: toTransaction(result.txn),
      balance: result.account.balance,
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw await duplicate(accountId, referenceId)
    throw err
  }
}

const getHistory = async (req, res) => {
  const accountId = req.params.id
  const page = Number(req.query.page || 1)
  const limit = Number(req.query.limit || 10)
  const where = { accountId }
  if (req.query.type) where.type = req.query.type

  await findAccount(accountId)

  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  res.json({
    data: rows.map(toTransaction),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  })
}

const transfer = async (req, res) => {
  const { from_account_id: fromId, to_account_id: toId, amount } = req.body
  const referenceId = req.body.reference_id.trim()
  const description = req.body.description || 'Transfer'

  await findAccount(fromId)
  await findAccount(toId)

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: { accountId: fromId, type: 'debit', amount, description, referenceId },
      })
      await tx.transaction.create({
        data: { accountId: toId, type: 'credit', amount, description, referenceId },
      })

      // always touch the lower id first so two opposite transfers can't deadlock
      const steps = [
        { id: fromId, run: () => debit(tx, fromId, amount) },
        { id: toId, run: () => credit(tx, toId, amount) },
      ].sort((a, b) => (a.id < b.id ? -1 : 1))
      for (const step of steps) await step.run()

      const [from, to] = await Promise.all([
        tx.account.findUnique({ where: { id: fromId } }),
        tx.account.findUnique({ where: { id: toId } }),
      ])
      return { from, to }
    })

    res.status(201).json({
      reference_id: referenceId,
      amount,
      from: { account_id: fromId, balance: result.from.balance },
      to: { account_id: toId, balance: result.to.balance },
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'DUPLICATE_TRANSACTION', 'This reference_id was already used on one of the accounts')
    }
    throw err
  }
}

module.exports = { createAccount, listAccounts, getBalance, addTransaction, getHistory, transfer }
