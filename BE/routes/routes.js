const express = require('express')
const c = require('../controller/AccountController')
const v = require('../middleware/validate')

const router = express.Router()

router.post('/accounts', v.createAccount, c.createAccount)
router.get('/accounts', c.listAccounts)
router.get('/accounts/:id/balance', v.accountId, c.getBalance)

router.post('/accounts/:id/transactions', v.accountId, v.addTransaction, c.addTransaction)
router.get('/accounts/:id/transactions', v.accountId, v.history, c.getHistory)

router.post('/transfers', v.transfer, c.transfer)

module.exports = router
