#!/usr/bin/env bash
# Docker Utility to simplify docker usage.
# Usage: ./du.sh <env> <rest>
#   env: dev / prod
#   rest:
#     up -d, stop db, ... -> Normal compose subcommands
#     db:deploy           -> Deploy database
#     db:stop             -> Stop database
#     db:reset            -> Reset database

set -e
set -o pipefail

# For emphasis and default answers in prompts
bold=$(tput bold)
# For errors or fatal issues
red=$(tput setaf 1)
# For warnings
yellow=$(tput setaf 3)
# For success messages and confirmations
green=$(tput setaf 2)
# For paths, code, or values
cyan=$(tput setaf 6)
# Resets the font
default=$(tput sgr0)

if [ -z "$1" ]; then
  echo "${red}No arguments passed.${default}"
  echo "Docs are in the source header. View using: ${cyan}less $0${default}"
  exit 1
fi

env=$1
if [ "$env" != "dev" ] && [ "$env" != "prod" ]; then
  echo "${red}Invalid environment $env.${default} Must be ${cyan}dev${default} or ${cyan}prod${default}."
  exit 1
fi

compose () {
  set -o xtrace
  docker compose --project-directory . \
    --file ./docker/compose.yml \
    --file "./docker/compose.$env.yml" \
    "$@"
}

if [ "$2" == "db:deploy" ]; then
  compose up --detach --build db
elif [ "$2" == "db:stop" ]; then
  compose stop db
elif [ "$2" == "db:reset" ]; then
  compose rm --stop --volumes db
else
  compose "${@:2}"
fi