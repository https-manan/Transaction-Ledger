require('dotenv').config()
const express = require('express')
const cors = require('cors')
const router = require('./routes/routes')
const { notFound, errorHandler } = require('./middleware/errorHandler')

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use('/', router)
app.use(notFound)
app.use(errorHandler)

app.listen(port, () => {
  console.log('Listening on port ' + port)
})
