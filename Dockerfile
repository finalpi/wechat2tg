FROM rust:buster as builder-gifski
RUN cargo install --version 1.7.0 gifski

FROM node:18-slim

RUN apt-get update && \
    apt-get install -y wget gnupg libx11-6 libx11-dev libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 libnss3 libatk-bridge2.0-0 libgbm1 libgtk-3-0 libasound2 && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/storage /app/save-files

# Create a non-root user and switch to it
RUN useradd -m wx2tg
USER wx2tg

WORKDIR /app
COPY --from=builder-gifski /usr/local/cargo/bin/gifski /usr/bin/gifski
COPY package*.json tsconfig.json ./

# Set environment variable to disable sandbox in Puppeteer
ENV BOT_TOKEN=""
ENV PROXY_PROTOCOL=""
ENV PROXY_HOST=""
ENV PROXY_PORT=""
ENV PROXY_USERNAME=""
ENV PROXY_PASSWORD=""
RUN npm install -g npm@10.7.0 && npm install

COPY . .

CMD [ "npm", "start" ]
