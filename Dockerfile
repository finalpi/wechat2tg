FROM rust:1.85 AS builder-gifski
RUN apt-get update && apt-get install -y \
    pkg-config \
    libpng-dev \
    libimagequant-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/ImageOptim/gifski.git /gifski
WORKDIR /gifski
RUN git fetch --tags && git checkout 1.34.0
RUN cargo build --release
RUN cp target/release/gifski /usr/local/cargo/bin/gifski

FROM gcc:13 AS builder-lottie-to-png

RUN apt update && \
    apt install --assume-yes git cmake python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages conan==2.0.10
RUN git clone --branch v1.1.1 https://github.com/ed-asriyan/lottie-converter.git /application

WORKDIR /application
RUN conan profile detect
RUN conan install . --build=missing -s build_type=Release
RUN cmake -DCMAKE_BUILD_TYPE=Release -DLOTTIE_MODULE=OFF CMakeLists.txt && cmake --build . --config Release
COPY --from=builder-gifski /usr/local/cargo/bin/gifski /usr/bin/gifski

# Keep the build and runtime on the same Node ABI and Debian libraries.
FROM node:18-slim AS runtime-base

# Media conversion libraries remain available; compilers belong in builder-app.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    fonts-wqy-microhei \
    libpixman-1-0 \
    libcairo2 \
    libpango1.0-0 \
    libgif7 \
    libjpeg62-turbo \
    libpng16-16 \
    librsvg2-2 \
    libvips42 \
    librlottie0-1 \
 && rm -rf /var/lib/apt/lists/*

FROM runtime-base AS builder-app
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ make python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json tsconfig.json ./
# The SDK is installed from the verified, lockfile-pinned local artifact.
COPY vendor/ ./vendor/
RUN npm install -g npm@10.7.0 && npm ci --no-audit --no-fund
# Compile the lockfile-installed SDK voice codec, not a second unpinned global copy.
RUN make -C node_modules/wx-voice/silk \
 && test -x node_modules/wx-voice/silk/encoder \
 && test -x node_modules/wx-voice/silk/decoder
COPY src/ ./src/
COPY webui/ ./webui/
COPY scripts/ ./scripts/
# TypeORM's optional ts-node peer keeps TS tooling even with --omit=dev.
# This image executes compiled JS only. Remove that optional loader explicitly;
# do NOT omit all optional dependencies (sharp needs its platform binaries).
RUN npm run build \
 && npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
 && rm -rf node_modules/typescript node_modules/ts-node \
 && find node_modules/.bin -xtype l -delete

FROM runtime-base AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /app/storage /app/save-files
COPY --from=builder-gifski /usr/local/cargo/bin/gifski /usr/bin/gifski
COPY --from=builder-lottie-to-png /application/bin/lottie_to_png /usr/bin/lottie_to_png
COPY --from=builder-lottie-to-png /application/bin/lottie_common.sh /usr/bin
COPY --from=builder-lottie-to-png /application/bin/lottie_to_gif.sh /usr/bin
RUN chmod +x /usr/bin/lottie_to_png /usr/bin/lottie_common.sh /usr/bin/lottie_to_gif.sh

COPY --from=builder-app /app/node_modules ./node_modules
COPY --from=builder-app /app/dist ./dist
COPY package.json package-lock.json VERSION ./
# Preserve the documented MCP stdio entry point; omit other development scripts.
COPY scripts/wechat-mcp.cjs ./scripts/wechat-mcp.cjs
RUN ln -s /app/node_modules/wx-voice/bin.js /usr/local/bin/wx-voice
# Fail the build if pruning broke native codecs, SQLite, automation or WebUI assets.
# The check is mounted, not shipped in the runtime image, and uses synthetic data only.
RUN --network=none --mount=type=bind,source=scripts/test-docker-runtime.cjs,target=/tmp/test-docker-runtime.cjs \
    node /tmp/test-docker-runtime.cjs

CMD [ "npm", "start" ]