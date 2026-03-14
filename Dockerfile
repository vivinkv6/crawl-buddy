# Stage 1 — Build
FROM node:22.12-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

RUN npx prisma generate

COPY . .

RUN npm run build

# Stage 2 — Production
FROM node:22.12-alpine AS runner

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY public ./public
COPY views ./views

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
