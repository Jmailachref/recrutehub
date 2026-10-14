#!/bin/sh
# Runs once, when the Postgres volume is first created: one database and one
# user per service, and no user can connect to another service's database.
set -e
for name in $SERVICE_DATABASES; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE ROLE $name LOGIN PASSWORD '$name';
CREATE DATABASE ${name}_db OWNER $name;
REVOKE CONNECT ON DATABASE ${name}_db FROM PUBLIC;
SQL
done
