/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs')
const path = require('node:path')

const destination = path.join(__dirname, '../dist/assets')
fs.mkdirSync(destination, {recursive: true})
fs.copyFileSync(path.join(__dirname, '../src/assets/bot-avatar.jpg'), path.join(destination, 'bot-avatar.jpg'))