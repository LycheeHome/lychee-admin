
export interface Scaffold {
  dockerfile: string;
  workflow: string;
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
COPY --from=builder /app/next.config.js* /app/next.config.mjs* /app/next.config.ts* ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q -O /dev/null "http://localhost:3000${healthcheckPath}" || exit 1
CMD ${toExecForm(runCommand)}
`;
}

const NEXTJS_DOCKERIGNORE = `node_modules
.next
Dockerfile
.git
.github
`;

// The scaffold is copied into the site's own GitHub repo. A pushed vX.Y.Z tag
// builds an image and pushes it to ghcr.io; the host runs that image, so
// nothing here knows where it runs. Plain shell, no third-party actions:
// every action is code with a token that can write packages.
const NEXTJS_RELEASE_WORKFLOW = `# Push a tag like v1.2.3 to build and publish ghcr.io/<owner>/<repo>:1.2.3.
# The tag is plain X.Y.Z, which is the only form the host's reconciler
# recognises. The source label links the package to this repo, so the
# package inherits the repo's access rather than needing its own.
name: release

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: read
  packages: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Log in to ghcr.io
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin

      - name: Build and push
        run: |
          IMAGE="ghcr.io/\${GITHUB_REPOSITORY,,}"
          VERSION="\${GITHUB_REF_NAME#v}"
          docker build --label org.opencontainers.image.source="https://github.com/$GITHUB_REPOSITORY" -t "$IMAGE:$VERSION" .
          docker push "$IMAGE:$VERSION"
`;

export function getFrameworkScaffold(
  framework: string,
  healthcheckPath: string,
): Scaffold | null {
  if (framework !== "nextjs") return null;
  return {
    dockerfile: nextjsDockerfile(NEXTJS_BUILD_COMMAND, NEXTJS_RUN_COMMAND, healthcheckPath),
    workflow: NEXTJS_RELEASE_WORKFLOW,
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
  healthcheckPath: string,
): { name: string; content: string }[] | null {
  const scaffold = getFrameworkScaffold(framework, healthcheckPath);
  if (!scaffold) return null;
  return [
    { name: "Dockerfile", content: scaffold.dockerfile },
    { name: ".dockerignore", content: scaffold.dockerignore },
    { name: ".github/workflows/release.yml", content: scaffold.workflow },
  ];
}
