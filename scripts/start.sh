#!/bin/sh
# Starts the whole stack. Runs on every Codespace start; later starts are quick.
#  1. checks out Code Playground next to this repo if it is not there yet
#  2. builds Code Playground's sandbox images when any is missing
#  3. builds and starts every container, then loads the sample coding problems
set -e
cd "$(dirname "$0")/.."
CODEPLAY_SOURCE="${CODEPLAY_SOURCE:-../code-playground}"
if [ ! -d "$CODEPLAY_SOURCE" ]; then
  git clone https://github.com/Jmailachref/code-playground.git "$CODEPLAY_SOURCE"
fi
for image in $(sed -n 's/^image: "\(.*\)"/\1/p' "$CODEPLAY_SOURCE"/languages/*/config.yaml); do
  docker image inspect "$image" >/dev/null 2>&1 || { (cd "$CODEPLAY_SOURCE" && sh languages/build.sh); break; }
done
docker compose up -d --build
echo "Waiting for the services..."
for service in auth offers questions candidates assessments notifications; do
  until curl -fsS "http://localhost:${GATEWAY_PORT:-80}/api/$service/health" >/dev/null 2>&1; do sleep 2; done
done
docker compose exec -T codeplay-api sh -c 'python -m api.seed examples/*/*.json' >/dev/null
echo
echo "RecruteHub is running on port ${GATEWAY_PORT:-80}. Code Playground: 8000, Mailpit: 8025, file browser: 8888."
