#!/bin/bash
set -e

cd /app

# Execute the command passed to the container
exec "$@"
