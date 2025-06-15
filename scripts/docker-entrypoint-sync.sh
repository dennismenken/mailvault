#!/bin/bash
set -e

echo "🔄 Mail Vault Sync Service"
echo "=========================="

# Function to wait for database file to be accessible
wait_for_database() {
    echo "📁 Waiting for data directory to be mounted..."
    while [ ! -d "/app/data" ]; do
        echo "⏳ Data directory not found, waiting..."
        sleep 2
    done
    echo "✅ Data directory found"
}

# Function to wait for main database to be ready
wait_for_main_database() {
    echo "📊 Waiting for main database to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if [ -f "/app/data/database/main.db" ]; then
            echo "✅ Main database found"
            return 0
        fi
        
        echo "⏳ Attempt $attempt/$max_attempts: Main database not ready, waiting..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "⚠️ Main database not found after $max_attempts attempts"
    echo "🚀 Starting sync service anyway (database will be created if needed)"
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
    echo "🏁 Starting Mail Vault Sync Service setup..."
    
    # Wait for mounted volumes
    wait_for_database
    
    # Generate Prisma client (in case it's missing)
    generate_prisma_client
    
    # Wait for main database (created by web service)
    wait_for_main_database
    
    echo "✅ Sync service setup completed!"
    echo "🚀 Starting sync service: $@"
    echo "=========================="
    
    # Execute the main command
    exec "$@"
}

# Run main function with all arguments
main "$@" 