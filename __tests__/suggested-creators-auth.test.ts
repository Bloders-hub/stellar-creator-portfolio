import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSession, findUnique, getSuggestedCreators, matchCreatorsForBounty } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUnique: vi.fn(),
  getSuggestedCreators: vi.fn(),
  matchCreatorsForBounty: vi.fn(),
}));

vi.mock('@/lib/auth/auth', () => ({ getServerSession }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bounty: {
      findUnique,
    },
  },
}));
vi.mock('@/lib/match-creators', () => ({
  getSuggestedCreators,
  matchCreatorsForBounty,
  TOP_MATCHES: 5,
}));

import { GET, POST } from '@/app/api/bounties/[id]/suggested-creators/route';

function createGetRequest(url = 'http://localhost/api/bounties/bounty-1/suggested-creators') {
  return new NextRequest(url, { method: 'GET' });
}

function createPostRequest(url = 'http://localhost/api/bounties/bounty-1/suggested-creators') {
  return new NextRequest(url, { method: 'POST' });
}

describe('/api/bounties/[id]/suggested-creators authorization guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation & Authorization (GET)', () => {
    it('returns 400 when bounty id is empty or whitespace', async () => {
      const req = createGetRequest('http://localhost/api/bounties/%20/suggested-creators');
      const res = await GET(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid bounty id');
    });

    it('returns 404 when bounty does not exist in database', async () => {
      findUnique.mockResolvedValue(null);

      const req = createGetRequest();
      const res = await GET(req, { params: Promise.resolve({ id: 'nonexistent-bounty' }) });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('Bounty not found');
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'nonexistent-bounty' },
        select: { creatorId: true },
      });
    });

    it('returns 401 when no session is present (unauthenticated)', async () => {
      findUnique.mockResolvedValue({ creatorId: 'owner-user-id' });
      getServerSession.mockResolvedValue(null);

      const req = createGetRequest();
      const res = await GET(req, { params: Promise.resolve({ id: 'bounty-1' }) });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('returns 403 when authenticated user is neither creator nor admin', async () => {
      findUnique.mockResolvedValue({ creatorId: 'owner-user-id' });
      getServerSession.mockResolvedValue({
        user: { id: 'another-user-id', role: 'USER' },
      });

      const req = createGetRequest();
      const res = await GET(req, { params: Promise.resolve({ id: 'bounty-1' }) });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    it('allows access (200) when authenticated user is the bounty creator', async () => {
      findUnique.mockResolvedValue({ creatorId: 'owner-user-id' });
      getServerSession.mockResolvedValue({
        user: { id: 'owner-user-id', role: 'USER' },
      });
      getSuggestedCreators.mockResolvedValue([{ id: 'c1', name: 'Creator One' }]);

      const req = createGetRequest();
      const res = await GET(req, { params: Promise.resolve({ id: 'bounty-1' }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bountyId).toBe('bounty-1');
      expect(json.suggestions).toHaveLength(1);
    });

    it('allows access (200) when authenticated user has ADMIN role', async () => {
      findUnique.mockResolvedValue({ creatorId: 'owner-user-id' });
      getServerSession.mockResolvedValue({
        user: { id: 'admin-user-id', role: 'ADMIN' },
      });
      getSuggestedCreators.mockResolvedValue([]);

      const req = createGetRequest();
      const res = await GET(req, { params: Promise.resolve({ id: 'bounty-1' }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bountyId).toBe('bounty-1');
    });
  });

  describe('Validation & Authorization (POST)', () => {
    it('returns 401 on POST when unauthenticated', async () => {
      findUnique.mockResolvedValue({ creatorId: 'owner-user-id' });
      getServerSession.mockResolvedValue(null);

      const req = createPostRequest();
      const res = await POST(req, { params: Promise.resolve({ id: 'bounty-1' }) });

      expect(res.status).toBe(401);
      expect(matchCreatorsForBounty).not.toHaveBeenCalled();
    });

    it('returns 403 on POST when called by a non-owner user', async () => {
      findUnique.mockResolvedValue({ creatorId: 'owner-user-id' });
      getServerSession.mockResolvedValue({
        user: { id: 'stranger-id', role: 'USER' },
      });

      const req = createPostRequest();
      const res = await POST(req, { params: Promise.resolve({ id: 'bounty-1' }) });

      expect(res.status).toBe(403);
      expect(matchCreatorsForBounty).not.toHaveBeenCalled();
    });

    it('triggers creator matching and notifications (200) when called by bounty owner', async () => {
      findUnique.mockResolvedValue({ creatorId: 'owner-user-id' });
      getServerSession.mockResolvedValue({
        user: { id: 'owner-user-id', role: 'USER' },
      });
      matchCreatorsForBounty.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

      const req = createPostRequest();
      const res = await POST(req, { params: Promise.resolve({ id: 'bounty-1' }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.notified).toBe(2);
      expect(matchCreatorsForBounty).toHaveBeenCalledWith('bounty-1');
    });
  });
});
