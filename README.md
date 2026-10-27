# Transaction Ledger API

Small ledger backend: create accounts, post credits/debits, check balance, read paginated history. Transfers between accounts are included as the bonus.

Stack: Node, Express 5, PostgreSQL, Prisma 7. The frontend is a single HTML file.

## Running it

You need Node 20+ and a Postgres database.

```bash
cd BE
npm install
cp .env.example .env      # put your own DATABASE_URL in it
npx prisma migrate deploy
npx prisma generate
npm start
```

The API runs on `http://localhost:3000`. For the frontend, open `FE/index.html` in a browser (API address is the `API` constant at the top of the script).

There's also a script that checks every rule in the assignment against a running server:

```bash
npm test
```

## Endpoints

| Method | Path | What it does |
|---|---|---|
| POST | `/accounts` | create account, body `{ "name": "Alice" }` |
| GET | `/accounts` | list accounts (the frontend uses this) |
| GET | `/accounts/:id/balance` | `{ account_id, balance }` |
| POST | `/accounts/:id/transactions` | add a credit or debit |
| GET | `/accounts/:id/transactions` | history, `?type=credit\|debit&page=1&limit=10` |
| POST | `/transfers` | move money between two accounts |

Add transaction body:

```json
{ "type": "debit", "amount": 30, "description": "coffee", "reference_id": "order-123" }
```

Transfer body:

```json
{ "from_account_id": "...", "to_account_id": "...", "amount": 30, "reference_id": "tr-1", "description": "rent" }
```

History response:

```json
{
  "data": [ { "id": "...", "account_id": "...", "type": "credit", "amount": 50, "description": "", "reference_id": "r2", "created_at": "..." } ],
  "pagination": { "page": 1, "limit": 10, "total": 4, "total_pages": 1 }
}
```

### Errors

All errors look the same:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance for this debit" } }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad name, type, amount, reference_id, transfer body (field list in `details`) |
| 400 | `INVALID_PAGINATION` | bad `page`, `limit` or `type` in the history query |
| 400 | `INVALID_ACCOUNT_ID` | id is not a valid uuid |
| 400 | `INVALID_JSON` | body can't be parsed |
| 404 | `ACCOUNT_NOT_FOUND` | account doesn't exist |
| 409 | `DUPLICATE_TRANSACTION` | reference_id already used on that account, existing transaction comes back in `details` |
| 422 | `INSUFFICIENT_BALANCE` | debit or transfer is bigger than the balance |

## How the integrity part works

- Inserting the transaction and changing the balance happen inside one Prisma `$transaction`, so either both are saved or neither.
- A debit is a single `UPDATE ... WHERE balance >= amount`, so two debits arriving together can't both pass the balance check.
- `UNIQUE (accountId, referenceId)` handles duplicates, even when the same request is fired several times at once.
- The migration adds checks for `balance >= 0`, `amount > 0` and `type IN ('credit','debit')`, and a trigger that blocks any UPDATE or DELETE on the Transaction table. The API also has no edit or delete routes.
- A transfer writes a debit row on the source and a credit row on the destination (both with the same reference_id) and updates both balances in one database transaction. Accounts are always updated in id order so opposite transfers don't deadlock.

## Assumptions

- Amounts are whole numbers (think paise or cents), max 1,000,000,000. No decimals.
- If the client sends `balance` when creating an account it's ignored, balance always starts at 0.
- Account id comes from the URL for transactions, not the body.
- A duplicate reference_id returns 409 and nothing changes. The original transaction is included in the response.
- reference_id is trimmed, and case matters (`A1` and `a1` are different).
- A transfer's reference_id must be unused on both accounts.
- No login/auth, the assignment doesn't ask for it.
- Transactions only exist in the API as create + read, nothing can be changed afterwards.

## Layout

```
BE/
  controller/AccountController.js
  middleware/        validate.js, errorHandler.js
  routes/routes.js
  prisma/            schema + migration
  prismaConnection.js
  server.js
  test.js
FE/index.html
```
