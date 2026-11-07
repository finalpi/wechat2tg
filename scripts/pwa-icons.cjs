/* eslint-disable @typescript-eslint/no-var-requires */
// Optional regeneration using the project's existing sharp dependency; not a build prerequisite.
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

async function main() {
  const directory = path.join(__dirname, '../webui/public/icons')
  const favicon = fs.readFileSync(path.join(__dirname, '../webui/public/favicon.svg'))
  fs.mkdirSync(directory, {recursive: true})
  for (const size of [192, 512]) {
    await sharp(favicon).resize(size, size).png().toFile(path.join(directory, `icon-${size}.png`))
  }
  await sharp(favicon).resize(180, 180).flatten({background: '#4f46e5'}).png()
    .toFile(path.join(directory, 'apple-touch-icon.png'))
  // Keep the original mark inside the central maskable safe zone, on a full-bleed background.
  const mark = await sharp(favicon).resize(320, 320).png().toBuffer()
  await sharp({create: {width: 512, height: 512, channels: 4, background: '#4f46e5'}})
    .composite([{input: mark, left: 96, top: 96}]).png().toFile(path.join(directory, 'maskable-512.png'))
}
main().catch(error => {console.error(error); process.exitCode = 1})