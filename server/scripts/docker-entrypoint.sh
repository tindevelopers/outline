#!/bin/sh
# Applies pending database migrations, then starts the server.
#
# The deploy pipeline does not run migrations: the image is swapped by
# Watchtower and the container's command is just the server. Without this step a
# schema change would only reach the database after the code that depends on it
# was already serving traffic. Running here means the schema is up to date
# before the server accepts a request.
#
# `set -e` makes a failed migration exit non-zero, so the container restarts
# visibly instead of serving traffic against an unknown schema.
#
# This assumes a single replica. Two containers starting simultaneously would
# race, and Sequelize's migration table has no locking across processes. The
# `outline` service in docker-compose.hetzner.yml is defined without replicas
# for this reason.
set -e

echo "Applying database migrations…"
node node_modules/sequelize-cli/lib/sequelize db:migrate

# exec so signals (SIGTERM from a container stop) reach the server directly.
exec "$@"
