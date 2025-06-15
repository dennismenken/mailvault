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

# Function to run main database migrations
run_main_migrations() {
    echo "🔄 Running main database migrations..."
    
    # Ensure database directory exists
    mkdir -p /app/data
    
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

# Function to generate Prisma client
generate_prisma_client() {
    echo "🔄 Generating Prisma client..."
    
    if npx prisma generate; then
        echo "✅ Prisma client generated"
    else
        echo "❌ Prisma client generation failed"
        exit 1
    fi
}

# Main execution
main() {
    echo "🏁 Starting Mail Vault setup..."
    
    # Wait for mounted volumes
    wait_for_database
    
    # Generate Prisma client (in case it's missing)
    generate_prisma_client
    
    # Run migrations
    run_main_migrations
    run_account_migrations
    
    echo "✅ Setup completed successfully!"
    echo "🚀 Starting application: $@"
    echo "================================"
    
    # Execute the main command
    exec "$@"
}

# Run main function with all arguments
main "$@" 