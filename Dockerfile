FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .

ENV DOCKER=1 \
    WORD_TTS_PROTOCOL=https \
    OFFICE_ADDIN_DEV_CERTS_DIR=/certs \
    TTS_API_BASE_URL=https://localhost:5529/v1/ \
    PORT=3000

EXPOSE 3000

COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
