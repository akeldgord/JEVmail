FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM deps AS tools
COPY . .

FROM tools AS build
ENV NODE_ENV=production
RUN APP_URL=http://localhost:3000 \
    NEXTAUTH_URL=http://localhost:3000 \
    AUTH_SECRET=build-only-not-a-runtime-secret-000000 \
    GOOGLE_CLIENT_ID=build-only \
    GOOGLE_CLIENT_SECRET=build-only \
    JEVMODEL_API_KEY=build-only \
    JEV_MODEL=jev-1.13.0 \
    JEV_BASE_URL=https://api.typesafe.ai \
    APP_ENCRYPTION_KEY=build-only-not-a-runtime-secret-000000 \
    DATABASE_PATH=/tmp/jevmail-build.db \
    npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "start"]
