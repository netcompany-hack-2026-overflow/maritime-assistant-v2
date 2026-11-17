FROM node:20-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
# npm may nest some api deps under apps/api/node_modules; make sure the dir
# exists so the runtime COPY below never fails.
RUN mkdir -p apps/api/node_modules

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace packages/shared
RUN npm run prisma:generate --workspace apps/api
RUN npm run build --workspace apps/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/index.js"]
