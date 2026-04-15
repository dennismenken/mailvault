#!/bin/bash
set -e

echo "[entrypoint] Mail Vault"
echo "================================"

wait_for_database() {
    echo "[entrypoint] waiting for data directory to be mounted..."
    while [ ! -d "/app/data" ]; do
        echo "[entrypoint] data directory not found, waiting..."
        sleep 2
    done
    echo "[entrypoint] data directory found"
}

setup_data_directories() {
    echo "[entrypoint] setting up data directories..."

    HOST_UID=${HOST_UID:-1001}
    HOST_GID=${HOST_GID:-1001}

    mkdir -p /app/data/database
    mkdir -p /app/data/accounts
    mkdir -p /app/data/attachments

    echo "[entrypoint] data directories ready"
}

run_main_migrations() {
    echo "[entrypoint] running main database migrations..."

    if npx prisma migrate deploy; then
        echo "[entrypoint] main database migrations completed"
    else
        echo "[entrypoint] main database migrations failed"
        exit 1
    fi
}

check_account_migrations() {
    echo "[entrypoint] checking account database migrations..."

    if node scripts/migrate-account-databases.js; then
        echo "[entrypoint] account database check completed"
    else
        echo "[entrypoint] account database check failed (normal for first run)"
    fi
}

check_prisma_client() {
    echo "[entrypoint] checking Prisma client..."

    if [ -d "/app/src/generated/prisma" ]; then
        echo "[entrypoint] Prisma client found"
    else
        echo "[entrypoint] Prisma client not found, generating..."
        if npx prisma generate; then
            echo "[entrypoint] Prisma client generated"
        else
            echo "[entrypoint] Prisma client generation failed"
            exit 1
        fi
    fi
}

main() {
    echo "[entrypoint] starting Mail Vault setup..."

    wait_for_database
    setup_data_directories
    check_prisma_client
    run_main_migrations
    check_account_migrations

    echo "[entrypoint] setup completed"
    echo "[entrypoint] starting application: $@"
    echo "================================"

    exec "$@"
}

main "$@"
