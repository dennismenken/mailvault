#!/usr/bin/env node

const { BackgroundSyncService } = require('./background-sync');

async function main() {
  console.log('🚀 Mail Vault Background Sync Service');
  console.log('=====================================');
  
  const service = new BackgroundSyncService();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received shutdown signal...');
    await service.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received termination signal...');
    await service.stop();
    process.exit(0);
  });
  
  try {
    await service.start();
    
    // Keep process alive
    setInterval(async () => {
      const status = await service.getStatus();
      console.log(`\n💤 Service Status: ${status.isRunning ? 'Running' : 'Idle'}`);
      console.log(`📧 Active accounts: ${status.accounts.filter(a => a.isActive && a.syncEnabled).length}`);
      
      const nextSync = status.accounts.length > 0 ? 
        Math.min(...status.accounts.map(a => a.nextSyncAt.getTime())) : 
        Date.now() + status.syncInterval;
      console.log(`⏰ Next sync: ${new Date(nextSync).toLocaleString()}`);
    }, 5 * 60 * 1000); // Status update every 5 minutes
    
    console.log('\n💡 Press Ctrl+C to stop the service');
    
  } catch (error) {
    console.error('❌ Failed to start background sync service:', error.message);
    process.exit(1);
  }
}

main().catch(console.error); 