const { AppError } = require('./errorHandler')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_AMOUNT = 1_000_000_000

const fail = (details) => {
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request data', details)
}

const isText = (v) => typeof v === 'string' && v.trim().length > 0

const checkAmount = (amount, errors) => {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    errors.push({ field: 'amount', message: `amount must be a whole number between 1 and ${MAX_AMOUNT}` })
  }
}

const checkReference = (ref, errors) => {
  if (!isText(ref) || ref.trim().length > 100) {
    errors.push({ field: 'reference_id', message: 'reference_id is required (max 100 characters)' })
  }
}

const checkDescription = (desc, errors) => {
  if (desc !== undefined && (typeof desc !== 'string' || desc.length > 255)) {
    errors.push({ field: 'description', message: 'description must be a string up to 255 characters' })
  }
}

const accountId = (req, res, next) => {
  if (!UUID.test(req.params.id)) {
    throw new AppError(400, 'INVALID_ACCOUNT_ID', 'Account id is not a valid id')
  }
  next()
}

const createAccount = (req, res, next) => {
  const { name } = req.body || {}
  const errors = []
  if (!isText(name) || name.trim().length > 100) {
    errors.push({ field: 'name', message: 'name is required (max 100 characters)' })
  }
  if (errors.length) fail(errors)
  next()
}

const addTransaction = (req, res, next) => {
  const { type, amount, description, reference_id } = req.body || {}
  const errors = []
  if (type !== 'credit' && type !== 'debit') {
    errors.push({ field: 'type', message: "type must be 'credit' or 'debit'" })
  }
  checkAmount(amount, errors)
  checkReference(reference_id, errors)
  checkDescription(description, errors)
  if (errors.length) fail(errors)
  next()
}

const transfer = (req, res, next) => {
  const { from_account_id, to_account_id, amount, description, reference_id } = req.body || {}
  const errors = []
  if (!UUID.test(from_account_id)) errors.push({ field: 'from_account_id', message: 'valid account id required' })
  if (!UUID.test(to_account_id)) errors.push({ field: 'to_account_id', message: 'valid account id required' })
  if (from_account_id && from_account_id === to_account_id) {
    errors.push({ field: 'to_account_id', message: 'cannot transfer to the same account' })
  }
  checkAmount(amount, errors)
  checkReference(reference_id, errors)
  checkDescription(description, errors)
  if (errors.length) fail(errors)
  next()
}

const history = (req, res, next) => {
  const { type, page = '1', limit = '10' } = req.query
  const errors = []
  if (type !== undefined && type !== 'credit' && type !== 'debit') {
    errors.push({ field: 'type', message: "type must be 'credit' or 'debit'" })
  }
  if (!/^\d+$/.test(page) || Number(page) < 1) {
    errors.push({ field: 'page', message: 'page must be a positive integer' })
  }
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) {
    errors.push({ field: 'limit', message: 'limit must be an integer between 1 and 100' })
  }
  if (errors.length) {
    throw new AppError(400, 'INVALID_PAGINATION', 'Invalid query parameters', errors)
  }
  next()
}

module.exports = { accountId, createAccount, addTransaction, transfer, history }
