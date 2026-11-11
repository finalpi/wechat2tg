/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path')
const dockerfile = fs.readFileSync(path.join(__dirname,'../Dockerfile'),'utf8')
const runtime = dockerfile.split('FROM runtime-base AS runtime\n')[1]

test('runtime starts from the shared ABI base, not from the application build stage',()=>{
  assert.match(dockerfile,/FROM node:18-slim AS runtime-base/)
  assert.match(dockerfile,/FROM runtime-base AS builder-app/)
  assert(runtime,'separate runtime stage required')
  assert.match(runtime,/ENV NODE_ENV=production/)
  assert(!/npm (ci|install|prune)|COPY \. \./.test(runtime),'do not retain dependency downloads or a full checkout in final layers')
  assert(!/\b(gcc|g\+\+|make|python3)\b/.test(dockerfile.split('FROM runtime-base AS builder-app')[0].split('FROM node:18-slim AS runtime-base')[1]))
  assert.match(runtime,/CMD \[ "npm", "start" \]/,'preserve the existing startup command')
})
test('production artifacts retain compiled native voice, media tools and the MCP entry point',()=>{
  for(const pattern of [
    /make -C node_modules\/wx-voice\/silk/,
    /test -x node_modules\/wx-voice\/silk\/encoder/,
    /test -x node_modules\/wx-voice\/silk\/decoder/,
    /npm prune --omit=dev --ignore-scripts/,
    /rm -rf node_modules\/typescript node_modules\/ts-node/,
  ])assert.match(dockerfile,pattern)
  assert(!dockerfile.includes('--omit=optional'),'sharp platform binaries are runtime dependencies')
  for(const pattern of [
    /COPY --from=builder-app \/app\/node_modules \.\/node_modules/,
    /COPY --from=builder-app \/app\/dist \.\/dist/,
    /COPY package.json package-lock.json VERSION/,
    /COPY scripts\/wechat-mcp.cjs/,
    /COPY --from=builder-gifski .*\/usr\/bin\/gifski/,
    /COPY --from=builder-lottie-to-png .*lottie_to_png/,
    /ln -s \/app\/node_modules\/wx-voice\/bin.js \/usr\/local\/bin\/wx-voice/,
  ])assert.match(runtime,pattern)
})
test('every architecture must pass an offline smoke check in the actual final image',()=>{
  assert.match(runtime,/RUN --network=none --mount=type=bind,source=scripts\/test-docker-runtime.cjs,target=\/tmp\/test-docker-runtime.cjs/)
  assert.match(runtime,/node \/tmp\/test-docker-runtime.cjs/)
  assert(!runtime.includes('COPY scripts/test-docker-runtime.cjs'),'smoke fixtures do not ship')
})
test('Docker context excludes private local configuration and generated frontend output',()=>{
  const ignored = fs.readFileSync(path.join(__dirname,'../.dockerignore'),'utf8').trim().split('\n')
  for(const entry of ['.git','**/node_modules','dist','webui/dist','.env','.env.*','home_*.env','storage','config','.ovis','.pi'])assert(ignored.includes(entry),entry)
})