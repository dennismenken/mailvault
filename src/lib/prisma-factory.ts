import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@/generated/prisma';

/**
 * Resolve a SQLite datasource URL from either a `file:`-prefixed
 * datasource URL or a raw filesystem path. Relative paths are
 * resolved against the current working directory.
 */
function resolveSqlitePath(urlOrPath: string): string {
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
 *
 * In Prisma 7 every PrismaClient must be constructed with a driver adapter.
 * This helper centralises the adapter wiring so callers only need to pass
 * the target database path.
 */
export function createAccountPrismaClient(dbPath: string): PrismaClient {
  const absolutePath = resolveSqlitePath(dbPath);
  const adapter = new PrismaBetterSqlite3({ url: absolutePath });
  return new PrismaClient({ adapter });
}

/**
 * Create a PrismaClient for the central application database. The URL is
 * read from the DATABASE_URL environment variable; a missing value is
 * fatal to avoid silently writing to an unintended file.
 */
export function createMainPrismaClient(): PrismaClient {
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
