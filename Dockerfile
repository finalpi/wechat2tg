FROM rust:buster as builder-gifski
RUN cargo install --version 1.7.0 gifski

FROM gcc:13 as builder-lottie-to-png
ADD https://github.com/ed-asriyan/lottie-converter.git /application

RUN apt update && \
    apt install --assume-yes cmake python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages conan==2.0.10

WORKDIR /application
RUN conan profile detect
COPY conanfile.txt .
RUN conan install . --build=missing -s build_type=Release

COPY CMakeLists.txt .
COPY src src
RUN cmake -DCMAKE_BUILD_TYPE=Release -DLOTTIE_MODULE=OFF CMakeLists.txt && cmake --build . --config Release

FROM debian:buster-slim as lottie-to-gif
ADD https://github.com/ed-asriyan/lottie-converter.git /app
WORKDIR /app
COPY --from=builder-gifski /usr/local/cargo/bin/gifski /usr/bin/gifski
COPY --from=builder-lottie-to-png /application/bin/lottie_to_png /usr/bin/lottie_to_png
COPY bin/lottie_common.sh /usr/bin
COPY bin/lottie_to_gif.sh /usr/bin

FROM node:18-slim

RUN mkdir -p /app/storage /app/save-files

RUN apt update && apt-get --no-install-recommends install -y

WORKDIR /app
COPY --from=lottie-to-gif /usr/bin/gifski /usr/bin/gifski
COPY --from=lottie-to-gif /usr/bin/lottie_to_png /usr/bin/lottie_to_png
COPY --from=lottie-to-gif /app/bin/lottie_common.sh /usr/bin/lottie_to_png
COPY --from=lottie-to-gif /usr/bin/lottie_to_png /usr/bin/lottie_to_png
COPY package*.json tsconfig.json ./

ENV TGS_TO_GIF=/usr/local/bin/tgs_to_gif

RUN npm install -g npm@10.7.0 && npm install

COPY . .

CMD [ "npm", "start" ]
