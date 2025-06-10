# Stage 1: Build gifski
FROM rust:1.70-slim as builder-gifski
RUN cargo install --version 1.7.0 gifski

# Stage 2: Build lottie-to-png
FROM ubuntu:22.04 as builder-lottie-to-png
RUN apt-get update && \
    apt-get install --no-install-recommends -y \
    gcc \
    g++ \
    cmake \
    git \
    python3 \
    python3-pip \
    build-essential && \
    pip3 install conan==2.0.10 && \
    rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch v1.1.1 https://github.com/ed-asriyan/lottie-converter.git /application
WORKDIR /application
RUN conan profile detect && \
    conan install . --build=missing -s build_type=Release && \
    cmake -DCMAKE_BUILD_TYPE=Release -DLOTTIE_MODULE=OFF CMakeLists.txt && \
    cmake --build . --config Release

# Stage 3: Final runtime image - 保持与原版兼容
FROM node:18-alpine

# 安装运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
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
 && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Copy built binaries
COPY --from=builder-gifski /usr/local/cargo/bin/gifski /usr/bin/gifski
COPY --from=builder-lottie-to-png /application/bin/lottie_to_png /usr/bin/lottie_to_png
COPY --from=builder-lottie-to-png /application/bin/lottie_common.sh /usr/bin/
COPY --from=builder-lottie-to-png /application/bin/lottie_to_gif.sh /usr/bin/
RUN chmod +x /usr/bin/lottie_to_png /usr/bin/lottie_common.sh /usr/bin/lottie_to_gif.sh

# Install Node.js dependencies
COPY package*.json ./
RUN npm install -g npm@10.7.0 && \
    npm ci --only=production && \
    npm install wx-voice -g && \
    wx-voice compile && \
    npm cache clean --force

# Copy source code and build
COPY . .
RUN npm run build && \
    rm -rf src && \
    mkdir -p storage save-files

CMD ["node", "dist/app.js"]