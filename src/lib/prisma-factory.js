'use strict';

const path = require('node:path');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient } = require('../generated/prisma');

function resolveSqlitePath(urlOrPath) {
  let candidate = urlOrPath;

  if (candidate.startsWith('file:')) {
    candidate = candidate.slice('file:'.length);
  }

  if (candidate === ':memory:') {
    return candidate;
  }

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(process.cwd(), candidate);
}

/**
 * Create a PrismaClient instance bound to the given SQLite database path.
 * Mirrors the TypeScript factory in prisma-factory.ts for CommonJS callers.
 */
function createAccountPrismaClient(dbPath) {
  const absolutePath = resolveSqlitePath(dbPath);
  const adapter = new PrismaBetterSqlite3({ url: absolutePath });
  return new PrismaClient({ adapter });
}

/**
 * Create a PrismaClient for the central application database. Throws when
 * DATABASE_URL is not set so callers fail fast instead of writing to an
 * unintended file.
 */
function createMainPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The main Prisma client cannot be created without it.',
    );
  }
  const absolutePath = resolveSqlitePath(url);
  const adapter = new PrismaBetterSqlite3({ url: absolutePath });
  return new PrismaClient({ adapter });
}

module.exports = {
  createAccountPrismaClient,
  createMainPrismaClient,
};
