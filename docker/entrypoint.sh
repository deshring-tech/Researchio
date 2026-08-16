#!/bin/sh
#
# Container entrypoint.
#
# Applies pending migrations before the server accepts traffic, then hands PID 1
# to the application via `exec` so that SIGTERM reaches Node directly. Without
# `exec`, the shell stays PID 1, signals are swallowed, and every deploy ends in
# a ten-second SIGKILL — which for SQLite risks tearing down mid-write.

set -e

echo "[entrypoint] applying database migrations"

# `migrate deploy` only applies committed migrations and never prompts or
# resets, which is what makes it safe to run unattended on every boot.
#
# Invoked through node against the CLI's entry file rather than through
# node_modules/.bin/prisma: that shim is a symlink in the builder, and Docker
# dereferences symlinks on COPY, so relying on it means depending on the copied
# file keeping its executable bit and shebang. This path has neither concern.
node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] migrations applied; starting server"

exec "$@"
