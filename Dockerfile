FROM node:18-slim

RUN apt-get update

RUN mkdir -p /app/storage /app/save-files

WORKDIR /app
COPY package*.json tsconfig.json ./

ENV BOT_TOKEN=""
ENV PROXY_PROTOCOL=""
ENV PROXY_HOST=""
ENV PROXY_PORT=""
ENV PROXY_USERNAME=""
ENV PROXY_PASSWORD=""
RUN npm install -g npm@10.7.0 && npm install

COPY . .

CMD [ "npm", "start" ]
