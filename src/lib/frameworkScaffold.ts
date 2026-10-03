
export interface Scaffold {
  dockerfile: string;
  compose: string;
  dockerignore: string;
  buildCommand: string;
  runCommand: string;
}

const NEXTJS_BUILD_COMMAND = "npm run build";
const NEXTJS_RUN_COMMAND = "npm start";

// Docker's exec-form CMD needs a JSON array (e.g. ["npm","start"]) rather
// than a shell string — this only needs to handle simple space-separated
// commands like the ones above, not full shell syntax.
function toExecForm(command: string): string {
  return JSON.stringify(command.split(" "));
}

function nextjsDockerfile(buildCommand: string, runCommand: string, healthcheckPath: string): string {
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
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q -O /dev/null "http://localhost:3000${healthcheckPath}" || exit 1
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


export function getFrameworkScaffold(
  framework: string,
  port: string,
  healthcheckPath: string,
): Scaffold | null {
  if (framework !== "nextjs") return null;
  return {
    dockerfile: nextjsDockerfile(NEXTJS_BUILD_COMMAND, NEXTJS_RUN_COMMAND, healthcheckPath),
    compose: nextjsCompose(port),
    dockerignore: NEXTJS_DOCKERIGNORE,
    buildCommand: NEXTJS_BUILD_COMMAND,
    runCommand: NEXTJS_RUN_COMMAND,
  };
}

/**
 * The scaffold as files rather than fields, so the add handler that writes
 * them and the preview that lists them read one mapping. A fourth scaffold
 * file added here appears in the preview with no further change; a filename
 * kept only in the route would make the panel quietly wrong.
 */
export function getScaffoldFiles(
  framework: string,
  port: string,
  healthcheckPath: string,
): { name: string; content: string }[] | null {
  const scaffold = getFrameworkScaffold(framework, port, healthcheckPath);
  if (!scaffold) return null;
  return [
    { name: "Dockerfile", content: scaffold.dockerfile },
    { name: "docker-compose.yml", content: scaffold.compose },
    { name: ".dockerignore", content: scaffold.dockerignore },
  ];
}
