# Stage 1: Build gifski
FROM rust:1.70-slim as builder-gifski
RUN cargo install --version 1.7.0 gifski

# Stage 2: Build lottie-to-png
FROM gcc:13-slim as builder-lottie-to-png
RUN apt-get update && \
    apt-get install --no-install-recommends -y git cmake python3 python3-pip && \
    pip3 install --break-system-packages conan==2.0.10 && \
    rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch v1.1.1 https://github.com/ed-asriyan/lottie-converter.git /application
WORKDIR /application
RUN conan profile detect && \
    conan install . --build=missing -s build_type=Release && \
    cmake -DCMAKE_BUILD_TYPE=Release -DLOTTIE_MODULE=OFF CMakeLists.txt && \
    cmake --build . --config Release

# Stage 3: Build Node.js application
FROM node:18-alpine as builder-node
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Stage 4: Final runtime image
FROM node:18-alpine
RUN apk add --no-cache \
    ffmpeg \
    font-noto-cjk \
    pixman \
    cairo \
    pango \
    giflib \
    libjpeg-turbo \
    libpng \
    librsvg \
    vips && \
    rm -rf /var/cache/apk/*

# Install wx-voice globally
RUN npm install -g wx-voice@latest && \
    wx-voice compile && \
    npm cache clean --force

WORKDIR /app

# Copy built binaries
COPY --from=builder-gifski /usr/local/cargo/bin/gifski /usr/bin/gifski
COPY --from=builder-lottie-to-png /application/bin/lottie_to_png /usr/bin/lottie_to_png
COPY --from=builder-lottie-to-png /application/bin/lottie_common.sh /usr/bin/
COPY --from=builder-lottie-to-png /application/bin/lottie_to_gif.sh /usr/bin/
RUN chmod +x /usr/bin/lottie_to_png /usr/bin/lottie_common.sh /usr/bin/lottie_to_gif.sh

# Copy node modules and app
COPY --from=builder-node /app/node_modules ./node_modules
COPY . .

# Create necessary directories
RUN mkdir -p storage save-files

# Build TypeScript
RUN npm run build && \
    rm -rf src tsconfig.json && \
    npm prune --production

USER node
EXPOSE 3000
CMD ["node", "dist/app.js"]