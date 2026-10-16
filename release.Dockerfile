# The release image is a tarball with a tag: no OS, no entrypoint. The host
# pulls it, verifies its attestation and unpacks /app; nothing here ever runs
# as a container. Built by the `release` job in .github/workflows/ci.yml.
FROM scratch
COPY release/ /app/
LABEL org.opencontainers.image.source=https://github.com/LycheeHome/lychee-admin
