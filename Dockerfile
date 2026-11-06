FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/sampleon/package.json apps/sampleon/
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/sampleon/package.json apps/sampleon/
COPY --from=build /app/apps/sampleon/dist apps/sampleon/dist
COPY --from=build /app/apps/sampleon/migrations apps/sampleon/migrations
COPY --from=build /app/apps/sampleon/public apps/sampleon/public
USER node
EXPOSE 4600
CMD ["node", "apps/sampleon/dist/src/main.js"]
