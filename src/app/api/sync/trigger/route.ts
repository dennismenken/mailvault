import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let body: { accountId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const accountId = typeof body.accountId === 'string' ? body.accountId : undefined;

  if (accountId) {
    const account = await prisma.imapAccount.findFirst({
      where: { id: accountId, userId: session.user.id },
      select: { id: true },
    });
    if (!account) {
      return NextResponse.json({ message: 'Account not found' }, { status: 404 });
    }
  }

  const syncServiceUrl = process.env.SYNC_SERVICE_URL;
  if (!syncServiceUrl) {
    return NextResponse.json(
      { message: 'SYNC_SERVICE_URL is not configured' },
      { status: 503 },
    );
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.SYNC_TRIGGER_TOKEN) {
    headers['x-sync-token'] = process.env.SYNC_TRIGGER_TOKEN;
  }

  try {
    const response = await fetch(`${syncServiceUrl.replace(/\/$/, '')}/trigger`, {
      method: 'POST',
      headers,
      body: JSON.stringify(accountId ? { accountId } : {}),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return NextResponse.json(
        { message: `sync service rejected trigger (${response.status})`, detail: text },
        { status: 502 },
      );
    }

    const data = await response.json().catch(() => ({}));
    return NextResponse.json({ queued: data.queued ?? (accountId || 'all') });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { message: 'sync service unreachable', detail: message },
      { status: 502 },
    );
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const syncServiceUrl = process.env.SYNC_SERVICE_URL;
  if (!syncServiceUrl) {
    return NextResponse.json(
      { message: 'SYNC_SERVICE_URL is not configured' },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${syncServiceUrl.replace(/\/$/, '')}/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { message: `sync service status failed (${response.status})` },
        { status: 502 },
      );
    }

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { message: 'sync service unreachable', detail: message },
      { status: 502 },
    );
  }
}
