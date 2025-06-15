#!/bin/bash
set -e

echo "🚀 Mail Vault Docker Entrypoint"
echo "================================"

# Function to wait for database file to be accessible
wait_for_database() {
    echo "📁 Waiting for data directory to be mounted..."
    while [ ! -d "/app/data" ]; do
        echo "⏳ Data directory not found, waiting..."
        sleep 2
    done
    echo "✅ Data directory found"
}

# Function to setup data directories
setup_data_directories() {
    echo "📁 Setting up data directories..."
    
    # Get host user/group IDs from environment
    HOST_UID=${HOST_UID:-1001}
    HOST_GID=${HOST_GID:-1001}
    
    # Ensure database directory exists (as root)
    mkdir -p /app/data/database
    mkdir -p /app/data/accounts
    mkdir -p /app/data/attachments
    
    # Set proper ownership (not needed when running as root)
    # chown -R $HOST_UID:$HOST_GID /app/data
    
    echo "✅ Data directories setup completed"
}

# Function to run main database migrations
run_main_migrations() {
    echo "🔄 Running main database migrations..."
    
    # Run Prisma migrations
    if npx prisma migrate deploy; then
        echo "✅ Main database migrations completed"
    else
        echo "❌ Main database migrations failed"
        exit 1
    fi
}

# Function to run account database migrations
run_account_migrations() {
    echo "🔄 Running account database migrations..."
    
    if node scripts/migrate-account-databases.js; then
        echo "✅ Account database migrations completed"
    else
        echo "⚠️ Account database migrations failed (this is normal for first run)"
    fi
}

# Function to check Prisma client
check_prisma_client() {
    echo "🔍 Checking Prisma client..."
    
    if [ -d "/app/src/generated/prisma" ]; then
        echo "✅ Prisma client found"
    else
        echo "⚠️ Prisma client not found, generating..."
        if npx prisma generate; then
            echo "✅ Prisma client generated"
        else
            echo "❌ Prisma client generation failed"
            exit 1
        fi
    fi
}

# Main execution
main() {
    echo "🏁 Starting Mail Vault setup..."
    
    # Wait for mounted volumes
    wait_for_database
    
    # Setup data directories (as root)
    setup_data_directories
    
    # Check Prisma client (only generate if missing)
    check_prisma_client
    
    # Run migrations
    run_main_migrations
    run_account_migrations
    
    echo "✅ Setup completed successfully!"
    echo "🚀 Starting application as nextjs user: $@"
    echo "================================"
    
    # Execute the main command as root (avoids permission issues)
    exec "$@"
}

# Run main function with all arguments
main "$@" 