#!/bin/bash
set -e

echo "[sync-entrypoint] Mail Vault Sync Service"
echo "=========================="

wait_for_database() {
    echo "[sync-entrypoint] waiting for data directory to be mounted..."
    while [ ! -d "/app/data" ]; do
        echo "[sync-entrypoint] data directory not found, waiting..."
        sleep 2
    done
    echo "[sync-entrypoint] data directory found"
}

wait_for_main_database() {
    echo "[sync-entrypoint] waiting for main database to be ready..."
    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if [ -f "/app/data/database/main.db" ]; then
            echo "[sync-entrypoint] main database found"
            return 0
        fi

        echo "[sync-entrypoint] attempt $attempt/$max_attempts: main database not ready, waiting..."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo "[sync-entrypoint] main database not found after $max_attempts attempts"
    echo "[sync-entrypoint] starting sync service anyway (database will be created if needed)"
}

check_prisma_client() {
    echo "[sync-entrypoint] checking Prisma client..."

    if [ -d "/app/src/generated/prisma" ]; then
        echo "[sync-entrypoint] Prisma client found"
    else
        echo "[sync-entrypoint] Prisma client not found, generating..."
        if npx prisma generate; then
            echo "[sync-entrypoint] Prisma client generated"
        else
            echo "[sync-entrypoint] Prisma client generation failed"
            exit 1
        fi
    fi
}

check_account_migrations() {
    echo "[sync-entrypoint] checking account database migrations..."

    if node scripts/migrate-account-databases.js; then
        echo "[sync-entrypoint] account database check completed"
    else
        echo "[sync-entrypoint] account database check failed (normal if no accounts exist)"
    fi
}

main() {
    echo "[sync-entrypoint] starting Mail Vault Sync Service setup..."

    wait_for_database
    check_prisma_client
    wait_for_main_database
    check_account_migrations

    echo "[sync-entrypoint] sync service setup completed"
    echo "[sync-entrypoint] starting sync service: $@"
    echo "=========================="

    exec "$@"
}

main "$@"
