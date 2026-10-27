class AppError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const notFound = (req, res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Cannot ${req.method} ${req.path}`))
}

// every error leaves the API in the same shape: { error: { code, message, details? } }
const errorHandler = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    err = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON')
  }

  if (!(err instanceof AppError)) {
    console.error(err)
    err = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong')
  }

  const body = { code: err.code, message: err.message }
  if (err.details) body.details = err.details
  res.status(err.status).json({ error: body })
}

module.exports = { AppError, notFound, errorHandler }
