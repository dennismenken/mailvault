#!/usr/bin/env node
'use strict';

const { BackgroundSyncService } = require('./background-sync');

async function main() {
  console.log('[sync] Mail Vault Background Sync Service');
  console.log('=========================================');

  const service = new BackgroundSyncService();

  const shutdown = async (signal) => {
    console.log(`[sync] received ${signal}, shutting down...`);
    try {
      await service.stop();
    } catch (error) {
      console.error('[sync] shutdown error:', error.message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error('[sync] unhandled rejection:', message);
  });

  process.on('uncaughtException', (error) => {
    console.error('[sync] uncaught exception:', error && error.message ? error.message : String(error));
  });

  await service.start();

  setInterval(async () => {
    try {
      const status = await service.getStatus();
      const active = status.accounts.filter((a) => a.isActive && a.syncEnabled).length;
      const disabled = status.accounts.filter((a) => !a.syncEnabled).length;
      console.log(`[sync] heartbeat: running=${status.isRunning}, inFlight=${status.cycleInFlight}, active=${active}, disabled=${disabled}`);
    } catch (error) {
      console.error('[sync] heartbeat failed:', error.message);
    }
  }, 5 * 60 * 1000);
}

main().catch((error) => {
  console.error('[sync] failed to start:', error && error.message ? error.message : String(error));
  process.exit(1);
});
