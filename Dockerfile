FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .

ENV WORD_TTS_PROTOCOL=http \
    PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]
