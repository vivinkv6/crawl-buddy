# Stage 1: Dependencies
FROM node:22.12-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Build
FROM node:22.12-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci && npx prisma generate
COPY . .
RUN npm run build && npm cache clean --force

# Stage 3: Production - minimal image
FROM node:22.12-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=error

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/package.json ./

RUN chown -R nestjs:nodejs /app

USER nestjs
EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
