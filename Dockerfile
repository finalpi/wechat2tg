FROM node:18-slim

RUN apt-get update && apt-get install -y p7zip-full && mkdir -p /app/storage /app/save-files

WORKDIR /app
COPY package*.json tsconfig.json ./

ENV BOT_TOKEN=""
ENV PROXY_PROTOCOL=""
ENV PROXY_HOST=""
ENV PROXY_PORT=""
ENV PROXY_USERNAME=""
ENV PROXY_PASSWORD=""
RUN npm i -g node-gyp && npm i

COPY . .

CMD [ "npm", "start" ]
