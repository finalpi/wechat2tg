FROM rust:1.80 AS builder-gifski
RUN apt-get update && apt-get install -y \
    pkg-config \
    libpng-dev \
    libimagequant-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/ImageOptim/gifski.git /gifski
WORKDIR /gifski
RUN cargo build --release
RUN cp target/release/gifski /usr/bin/gifski

FROM gcc:13 as builder-lottie-to-png

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

FROM node:18-slim

# 安装 ffmpeg 和 gcc 以及其他运行时依赖
RUN apt update && apt-get install -y --no-install-recommends \
    ffmpeg \
    gcc \
    g++ \
    make \
    python3 \
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

RUN mkdir -p /app/storage /app/save-files

WORKDIR /app
COPY --from=builder-gifski /usr/local/cargo/bin/gifski /usr/bin/gifski
COPY --from=builder-lottie-to-png /application/bin/lottie_to_png /usr/bin/lottie_to_png
COPY --from=builder-lottie-to-png /application/bin/lottie_common.sh /usr/bin
COPY --from=builder-lottie-to-png /application/bin/lottie_to_gif.sh /usr/bin
RUN chmod +x /usr/bin/lottie_to_png /usr/bin/lottie_common.sh /usr/bin/lottie_to_gif.sh

COPY package*.json tsconfig.json ./
RUN npm install -g npm@10.7.0 && npm install
RUN npm install wx-voice -g
RUN wx-voice compile

# 复制源代码并编译
COPY . .
RUN npm run build

CMD [ "npm", "start" ]