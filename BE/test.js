// quick check against a running server: node test.js
const base = process.env.API_URL || 'http://localhost:3000'
let passed = 0, failed = 0

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

const check = (name, cond) => {
  cond ? passed++ : failed++
  console.log((cond ? 'ok   ' : 'FAIL ') + name)
}

const run = async () => {
  const a = (await call('POST', '/accounts', { name: 'Alice', balance: 999 })).body
  const b = (await call('POST', '/accounts', { name: 'Bob' })).body
  check('account starts at 0 even if client sends balance', a.balance === 0)
  check('empty name rejected', (await call('POST', '/accounts', { name: '  ' })).status === 400)

  const tx = (id, body) => call('POST', `/accounts/${id}/transactions`, body)
  const bal = async (id) => (await call('GET', `/accounts/${id}/balance`)).body.balance

  await tx(a.id, { type: 'credit', amount: 100, reference_id: 'r1' })
  await tx(a.id, { type: 'credit', amount: 50, reference_id: 'r2' })
  await tx(a.id, { type: 'debit', amount: 30, reference_id: 'r3' })
  await tx(a.id, { type: 'debit', amount: 20, reference_id: 'r4' })
  check('balance is 100 after the example sequence', (await bal(a.id)) === 100)

  const over = await tx(a.id, { type: 'debit', amount: 150, reference_id: 'r5' })
  check('overdraft rejected with 422', over.status === 422 && over.body.error.code === 'INSUFFICIENT_BALANCE')
  check('balance unchanged after rejection', (await bal(a.id)) === 100)

  const dup = await tx(a.id, { type: 'credit', amount: 500, reference_id: 'r1' })
  check('duplicate reference_id gives 409', dup.status === 409 && dup.body.error.code === 'DUPLICATE_TRANSACTION')
  check('balance unchanged after duplicate', (await bal(a.id)) === 100)
  check('same reference_id works on another account', (await tx(b.id, { type: 'credit', amount: 10, reference_id: 'r1' })).status === 201)

  check('bad type', (await tx(a.id, { type: 'x', amount: 5, reference_id: 'z' })).status === 400)
  check('zero amount', (await tx(a.id, { type: 'credit', amount: 0, reference_id: 'z' })).status === 400)
  check('negative amount', (await tx(a.id, { type: 'credit', amount: -5, reference_id: 'z' })).status === 400)
  check('decimal amount', (await tx(a.id, { type: 'credit', amount: 1.5, reference_id: 'z' })).status === 400)
  check('missing reference_id', (await tx(a.id, { type: 'credit', amount: 5 })).status === 400)
  check('unknown account on transaction', (await tx('11111111-1111-4111-8111-111111111111', { type: 'credit', amount: 5, reference_id: 'z' })).status === 404)
  check('malformed account id', (await call('GET', '/accounts/abc/balance')).status === 400)
  check('unknown account balance', (await call('GET', '/accounts/11111111-1111-4111-8111-111111111111/balance')).status === 404)

  const h = await call('GET', `/accounts/${a.id}/transactions?limit=3`)
  check('history paginates', h.body.data.length === 3 && h.body.pagination.total === 4 && h.body.pagination.total_pages === 2)
  check('history latest first', h.body.data[0].reference_id === 'r4')
  const h2 = await call('GET', `/accounts/${a.id}/transactions?type=debit`)
  check('history filters by type', h2.body.data.length === 2 && h2.body.data.every((t) => t.type === 'debit'))
  check('bad page', (await call('GET', `/accounts/${a.id}/transactions?page=0`)).status === 400)
  check('bad limit', (await call('GET', `/accounts/${a.id}/transactions?limit=abc`)).status === 400)
  check('bad history type', (await call('GET', `/accounts/${a.id}/transactions?type=foo`)).status === 400)

  // 10 debits of 30 at once against a balance of 100: exactly 3 may succeed
  const race = await Promise.all(
    Array.from({ length: 10 }, (_, i) => tx(a.id, { type: 'debit', amount: 30, reference_id: 'race' + i }))
  )
  check('concurrent debits never overdraw', race.filter((r) => r.status === 201).length === 3 && (await bal(a.id)) === 10)

  // same reference_id sent 5 times at once: only one lands
  const same = await Promise.all(
    Array.from({ length: 5 }, () => tx(b.id, { type: 'credit', amount: 7, reference_id: 'same' }))
  )
  check('concurrent duplicates create one transaction', same.filter((r) => r.status === 201).length === 1 && (await bal(b.id)) === 17)

  const t = await call('POST', '/transfers', { from_account_id: b.id, to_account_id: a.id, amount: 5, reference_id: 't1' })
  check('transfer moves money', t.status === 201 && (await bal(b.id)) === 12 && (await bal(a.id)) === 15)
  const tBad = await call('POST', '/transfers', { from_account_id: b.id, to_account_id: a.id, amount: 999, reference_id: 't2' })
  check('transfer with low balance rejected', tBad.status === 422)
  check('failed transfer left both balances alone', (await bal(b.id)) === 12 && (await bal(a.id)) === 15)
  const hb = await call('GET', `/accounts/${b.id}/transactions?limit=100`)
  check('failed transfer left no transaction rows', !hb.body.data.some((x) => x.reference_id === 't2'))
  check('transfer to missing account', (await call('POST', '/transfers', { from_account_id: b.id, to_account_id: '11111111-1111-4111-8111-111111111111', amount: 1, reference_id: 't3' })).status === 404)
  check('transfer to same account', (await call('POST', '/transfers', { from_account_id: b.id, to_account_id: b.id, amount: 1, reference_id: 't4' })).status === 400)
  check('duplicate transfer reference', (await call('POST', '/transfers', { from_account_id: b.id, to_account_id: a.id, amount: 1, reference_id: 't1' })).status === 409)

  check('no PUT on transactions', (await call('PUT', `/accounts/${a.id}/transactions/x`, {})).status === 404)
  check('no DELETE on transactions', (await call('DELETE', `/accounts/${a.id}/transactions/x`)).status === 404)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

run()
