export interface Scaffold {
  dockerfile: string;
  compose: string;
  dockerignore: string;
}

const NEXTJS_DOCKERFILE = `FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js* /app/next.config.mjs* ./
EXPOSE 3000
CMD ["npm", "start"]
`;

const NEXTJS_DOCKERIGNORE = `node_modules
.next
Dockerfile
docker-compose.yml
.git
`;

function nextjsCompose(port: string): string {
  return `services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:${port}:3000"
`;
}

export function getFrameworkScaffold(framework: string, port: string): Scaffold | null {
  if (framework !== "nextjs") return null;
  return { dockerfile: NEXTJS_DOCKERFILE, compose: nextjsCompose(port), dockerignore: NEXTJS_DOCKERIGNORE };
}
