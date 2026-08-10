import path from "node:path";

export interface Scaffold {
  dockerfile: string;
  compose: string;
  dockerignore: string;
  buildCommand: string;
  runCommand: string;
  deployWorkflow: string;
}

const NEXTJS_BUILD_COMMAND = "npm run build";
const NEXTJS_RUN_COMMAND = "npm start";

// Docker's exec-form CMD needs a JSON array (e.g. ["npm","start"]) rather
// than a shell string — this only needs to handle simple space-separated
// commands like the ones above, not full shell syntax.
function toExecForm(command: string): string {
  return JSON.stringify(command.split(" "));
}

function nextjsDockerfile(buildCommand: string, runCommand: string): string {
  return `FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ${buildCommand}

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js* /app/next.config.mjs* ./
EXPOSE 3000
CMD ${toExecForm(runCommand)}
`;
}

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

function nextjsDeployWorkflow(hostname: string, deployPath: string): string {
  return `name: Deploy ${hostname}

on:
  push:
    branches: [main]
  workflow_dispatch: {}

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4

      # Sync app source into the directory lyly-admin scaffolded, without
      # touching the generated Dockerfile/docker-compose.yml/.dockerignore.
      - name: Sync app files
        run: |
          rsync -rl --delete \\
            --exclude='.git' \\
            --exclude='Dockerfile' \\
            --exclude='docker-compose.yml' \\
            --exclude='.dockerignore' \\
            ./ ${deployPath}/

      - name: Build and deploy
        run: docker compose -f ${deployPath}/docker-compose.yml up -d --build
`;
}

export function getFrameworkScaffold(framework: string, port: string, hostname: string, sitesRoot: string): Scaffold | null {
  if (framework !== "nextjs") return null;
  const deployPath = path.posix.join(sitesRoot, hostname);
  return {
    dockerfile: nextjsDockerfile(NEXTJS_BUILD_COMMAND, NEXTJS_RUN_COMMAND),
    compose: nextjsCompose(port),
    dockerignore: NEXTJS_DOCKERIGNORE,
    buildCommand: NEXTJS_BUILD_COMMAND,
    runCommand: NEXTJS_RUN_COMMAND,
    deployWorkflow: nextjsDeployWorkflow(hostname, deployPath),
  };
}
