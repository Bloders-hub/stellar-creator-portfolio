import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { getSuggestedCreators, matchCreatorsForBounty, TOP_MATCHES } from '@/lib/match-creators';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Validates the bounty ID and ensures the requesting user is either
 * the bounty creator (owner) or a platform administrator.
 */
async function authorizeBountyOwner(id: string): Promise<NextResponse | null> {
  if (!id || typeof id !== 'string' || id.trim() === '') {
    return NextResponse.json({ error: 'Invalid bounty id' }, { status: 400 });
  }

  const bounty = await prisma.bounty.findUnique({
    where: { id },
    select: { creatorId: true },
  });

  if (!bounty) {
    return NextResponse.json({ error: 'Bounty not found' }, { status: 404 });
  }

  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as { id?: string; role?: string };
  const isOwner = Boolean(user.id && user.id === bounty.creatorId);
  const isAdmin = user.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}

/**
 * GET /api/bounties/[id]/suggested-creators
 * Returns the top matching creators for the bounty (read-only) for the
 * "Suggested Freelancers" sidebar. Restricted to bounty owner or admin.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const authError = await authorizeBountyOwner(id);
  if (authError) {
    return authError;
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || TOP_MATCHES, 1), 50) : TOP_MATCHES;

  const suggestions = await getSuggestedCreators(id, limit);
  return NextResponse.json({ bountyId: id, count: suggestions.length, suggestions });
}

/**
 * POST /api/bounties/[id]/suggested-creators
 * Runs matching for a newly created bounty and notifies the top creators via a
 * MatchNotification. Restricted to bounty owner or admin.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const authError = await authorizeBountyOwner(id);
  if (authError) {
    return authError;
  }

  const suggestions = await matchCreatorsForBounty(id);
  return NextResponse.json({
    bountyId: id,
    notified: suggestions.length,
    suggestions,
  });
}
