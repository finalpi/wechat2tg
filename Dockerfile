FROM rust:buster as builder-gifski
RUN cargo install --version 1.7.0 gifski

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

RUN mkdir -p /app/storage /app/save-files

RUN apt update && apt-get --no-install-recommends install -y

WORKDIR /app
COPY --from=builder-gifski /usr/local/cargo/bin/gifski /usr/bin/gifski
COPY --from=builder-lottie-to-png /application/bin/lottie_to_png /usr/bin/lottie_to_png
COPY --from=builder-lottie-to-png /application/bin/lottie_common.sh /usr/bin
COPY --from=builder-lottie-to-png /application/bin/lottie_to_gif.sh /usr/bin
COPY package*.json tsconfig.json ./

RUN npm install -g npm@10.7.0 && npm install

COPY . .

CMD [ "npm", "start" ]
