const fs = require('node:fs')
const path = require('node:path')
fs.cpSync(path.join(__dirname, '../src/webui/public'), path.join(__dirname, '../dist/webui/public'), {recursive: true})
