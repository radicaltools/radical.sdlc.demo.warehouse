# One image per service: docker build --build-arg SERVICE=<service> .
FROM node:24-slim
ARG SERVICE
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY tools ./tools
RUN npm ci --omit=dev --no-audit --no-fund
WORKDIR /app/services/${SERVICE}
ENV PORT=3000
USER node
CMD ["npx", "tsx", "src/main.ts"]
