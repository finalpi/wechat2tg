FROM node:16

RUN apt-get update && apt-get install -y libnss3

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