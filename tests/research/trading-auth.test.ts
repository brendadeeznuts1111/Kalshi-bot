import { describe, expect, test } from 'bun:test';
import {
  authenticateTradingPrincipal,
  loadTradingAuthConfig,
  requireTradingCancelPrincipal,
  requireTradingOrderPrincipal,
  type TradingAuthConfig,
} from '../../src/research/trading-auth.ts';

const TOKEN = 'correct-horse-battery-staple';

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function config(overrides: Partial<TradingAuthConfig> = {}): TradingAuthConfig {
  return {
    tokenSha256: hash(TOKEN),
    actorId: 'operator-1' as never,
    role: 'trade_operator',
    partnerScopes: new Set(['SPORTS' as never]),
    outScopes: new Set(['out-SPORTS-1' as never]),
    ...overrides,
  };
}

function request(
  body: Record<string, unknown>,
  token?: string,
  headers: Record<string, string> = {}
): Request {
  return new Request('http://localhost/api/trading/order', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const liveBody = {
  dryRun: false,
  partnerCode: 'SPORTS',
  outId: 'out-SPORTS-1',
};

describe('trading operator principal', () => {
  test('loads only a SHA-256 token binding and branded scopes from env', () => {
    const loaded = loadTradingAuthConfig({
      KALSHI_OPERATOR_TOKEN_SHA256: hash(TOKEN),
      KALSHI_OPERATOR_ACTOR_ID: 'operator-1',
      KALSHI_OPERATOR_ROLE: 'trade_operator',
      KALSHI_OPERATOR_PARTNER_SCOPES: 'SPORTS,OTHER',
      KALSHI_OPERATOR_OUT_SCOPES: 'out-SPORTS-1',
    });
    expect(loaded.tokenSha256).toBe(hash(TOKEN));
    expect(loaded.partnerScopes.has('OTHER' as never)).toBe(true);
    expect(JSON.stringify(loaded)).not.toContain(TOKEN);
  });

  test('rejects malformed or incomplete fail-closed configuration', () => {
    expect(() => loadTradingAuthConfig({})).toThrow();
    expect(() =>
      loadTradingAuthConfig({
        KALSHI_OPERATOR_TOKEN_SHA256: 'raw-secret',
        KALSHI_OPERATOR_ACTOR_ID: 'operator-1',
        KALSHI_OPERATOR_ROLE: 'admin',
        KALSHI_OPERATOR_PARTNER_SCOPES: '*',
        KALSHI_OPERATOR_OUT_SCOPES: '*',
      })
    ).toThrow('64-character');
  });

  test('authenticates a correctly hashed bearer without retaining the token', () => {
    const principal = authenticateTradingPrincipal(request(liveBody, TOKEN), config());
    expect(String(principal?.actorId)).toBe('operator-1');
    expect(principal).not.toHaveProperty('token');
    expect(authenticateTradingPrincipal(request(liveBody, 'wrong'), config())).toBeNull();
  });

  test('allows unauthenticated dry-run explicitly', async () => {
    let calls = 0;
    const response = await requireTradingOrderPrincipal(
      request({ dryRun: true }),
      () => {
        calls++;
        return Response.json({ ok: true });
      },
      {
        loadConfig: () => {
          throw new Error('not configured');
        },
      }
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(1);
  });

  test('fails live orders before downstream work when bearer is missing or wrong', async () => {
    for (const token of [undefined, 'wrong']) {
      let calls = 0;
      const response = await requireTradingOrderPrincipal(
        request(liveBody, token),
        () => {
          calls++;
          return new Response('must not run');
        },
        { loadConfig: () => config() }
      );
      expect(response.status).toBe(401);
      expect(calls).toBe(0);
    }
  });

  test('denies cross-partner and cross-out live orders', async () => {
    for (const body of [
      { ...liveBody, partnerCode: 'OTHER' },
      { ...liveBody, outId: 'out-SPORTS-2' },
    ]) {
      let calls = 0;
      const response = await requireTradingOrderPrincipal(
        request(body, TOKEN),
        () => {
          calls++;
          return new Response('must not run');
        },
        { loadConfig: () => config() }
      );
      expect(response.status).toBe(403);
      expect(calls).toBe(0);
    }
  });

  test('rejects body and header identity spoofing', async () => {
    for (const req of [
      request({ ...liveBody, userId: 'someone-else' }, TOKEN),
      request(liveBody, TOKEN, { 'x-user-id': 'someone-else' }),
    ]) {
      let calls = 0;
      const response = await requireTradingOrderPrincipal(
        req,
        () => {
          calls++;
          return new Response('must not run');
        },
        { loadConfig: () => config() }
      );
      expect(response.status).toBe(403);
      expect(calls).toBe(0);
    }
  });

  test('attaches the principal before an authorized live order', async () => {
    const req = request(liveBody, TOKEN, { 'x-user-id': 'operator-1' });
    const response = await requireTradingOrderPrincipal(
      req,
      () => Response.json({ actorId: req.tradingPrincipal?.actorId }),
      { loadConfig: () => config() }
    );
    expect(await response.json()).toEqual({ actorId: 'operator-1' });
  });

  test('requires authentication for every cancellation and blocks downstream', async () => {
    let calls = 0;
    const denied = await requireTradingCancelPrincipal(
      request({ orderId: 'order-1' }),
      () => {
        calls++;
        return new Response('must not run');
      },
      { loadConfig: () => config() }
    );
    expect(denied.status).toBe(401);
    expect(calls).toBe(0);

    const allowedReq = request({ orderId: 'order-1' }, TOKEN);
    const allowed = await requireTradingCancelPrincipal(
      allowedReq,
      () => {
        calls++;
        return Response.json({ actorId: allowedReq.tradingPrincipal?.actorId });
      },
      { loadConfig: () => config() }
    );
    expect(allowed.status).toBe(200);
    expect(calls).toBe(1);
  });
});
