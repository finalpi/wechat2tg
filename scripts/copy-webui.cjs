const fs = require('node:fs')
const path = require('node:path')

const destination = path.join(__dirname, '../dist/webui/public')
fs.rmSync(destination, {recursive: true, force: true})
// React bundle built by Vite.
fs.cpSync(path.join(__dirname, '../webui/dist'), destination, {recursive: true})
// WeChat emoji image assets referenced by the message center and API.
fs.cpSync(path.join(__dirname, '../src/webui/public/emoji'), path.join(destination, 'emoji'), {recursive: true})
