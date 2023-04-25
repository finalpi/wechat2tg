FROM node:16

WORKDIR /app

COPY package*.json ./

ENV BOT_TOKEN=""
ENV PROTOCOL=""
ENV HOST=""
ENV PORT=""
ENV USERNAME=""
ENV PASSWORD=""

RUN npm install

COPY . .

CMD [ "npm", "start" ]