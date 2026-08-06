export type OperatorActorId = string & { readonly __brand: 'OperatorActorId' };
export type TradingRole = 'trade_operator' | 'admin';
export type PartnerScope = string & { readonly __brand: 'PartnerScope' };
export type OutScope = string & { readonly __brand: 'OutScope' };

export interface TradingPrincipal {
  actorId: OperatorActorId;
  role: TradingRole;
  partnerScopes: ReadonlySet<PartnerScope>;
  outScopes: ReadonlySet<OutScope>;
}

export interface TradingAuthConfig {
  tokenSha256: string;
  actorId: OperatorActorId;
  role: TradingRole;
  partnerScopes: ReadonlySet<PartnerScope>;
  outScopes: ReadonlySet<OutScope>;
}

export type TradingAuthEnvironment = Record<string, string | undefined>;

declare global {
  interface Request {
    tradingPrincipal?: TradingPrincipal;
  }
}

const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/i;

function nonEmpty(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function scopes<T extends string>(raw: string | undefined, name: string): ReadonlySet<T> {
  const values = nonEmpty(raw, name)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must contain at least one scope`);
  return new Set(values as T[]);
}

export function loadTradingAuthConfig(env: TradingAuthEnvironment = Bun.env): TradingAuthConfig {
  const tokenSha256 = nonEmpty(env.KALSHI_OPERATOR_TOKEN_SHA256, 'KALSHI_OPERATOR_TOKEN_SHA256');
  if (!TOKEN_HASH_PATTERN.test(tokenSha256)) {
    throw new Error('KALSHI_OPERATOR_TOKEN_SHA256 must be a 64-character SHA-256 hex digest');
  }
  const role = nonEmpty(env.KALSHI_OPERATOR_ROLE, 'KALSHI_OPERATOR_ROLE');
  if (role !== 'trade_operator' && role !== 'admin') {
    throw new Error('KALSHI_OPERATOR_ROLE must be trade_operator or admin');
  }
  return {
    tokenSha256: tokenSha256.toLowerCase(),
    actorId: nonEmpty(env.KALSHI_OPERATOR_ACTOR_ID, 'KALSHI_OPERATOR_ACTOR_ID') as OperatorActorId,
    role,
    partnerScopes: scopes<PartnerScope>(
      env.KALSHI_OPERATOR_PARTNER_SCOPES,
      'KALSHI_OPERATOR_PARTNER_SCOPES'
    ),
    outScopes: scopes<OutScope>(env.KALSHI_OPERATOR_OUT_SCOPES, 'KALSHI_OPERATOR_OUT_SCOPES'),
  };
}

function digestToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

function constantTimeHexEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export function authenticateTradingPrincipal(
  req: Request,
  config: TradingAuthConfig
): TradingPrincipal | null {
  const token = bearerToken(req);
  if (!token || !constantTimeHexEqual(digestToken(token), config.tokenSha256)) return null;
  return {
    actorId: config.actorId,
    role: config.role,
    partnerScopes: config.partnerScopes,
    outScopes: config.outScopes,
  };
}

function authError(status: 401 | 403, code: string, error: string): Response {
  return Response.json({ ok: false, code, error }, { status });
}

function scopeAllows(scopes: ReadonlySet<string>, value: unknown): boolean {
  return (
    scopes.has('*') ||
    (typeof value === 'string' && value.trim() !== '' && scopes.has(value.trim()))
  );
}

function identityMatches(
  req: Request,
  body: Record<string, unknown>,
  principal: TradingPrincipal
): boolean {
  const headerUserId = req.headers.get('x-user-id')?.trim();
  const bodyUserId = typeof body.userId === 'string' ? body.userId.trim() : null;
  return (
    (!headerUserId || headerUserId === principal.actorId) &&
    (!bodyUserId || bodyUserId === principal.actorId)
  );
}

export interface TradingAuthOptions {
  loadConfig?: () => TradingAuthConfig;
}

function requirePrincipal(
  req: Request,
  body: Record<string, unknown>,
  options: TradingAuthOptions
): TradingPrincipal | Response {
  let config: TradingAuthConfig;
  try {
    config = (options.loadConfig ?? loadTradingAuthConfig)();
  } catch {
    return authError(401, 'E_OPERATOR_AUTH_REQUIRED', 'operator authentication is unavailable');
  }
  const principal = authenticateTradingPrincipal(req, config);
  if (!principal) {
    return authError(
      401,
      'E_OPERATOR_AUTH_REQUIRED',
      'valid operator bearer authentication is required'
    );
  }
  if (!identityMatches(req, body, principal)) {
    return authError(
      403,
      'E_OPERATOR_IDENTITY_MISMATCH',
      'request identity does not match authenticated operator'
    );
  }
  req.tradingPrincipal = principal;
  return principal;
}

async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.clone().json();
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Dry-run order previews are intentionally public; live mutations are not. */
export async function requireTradingOrderPrincipal(
  req: Request,
  next: () => Response | Promise<Response>,
  options: TradingAuthOptions = {}
): Promise<Response> {
  const body = await readJsonObject(req);
  if (!body) return next();
  if (body.dryRun !== false) return next();
  const principal = requirePrincipal(req, body, options);
  if (principal instanceof Response) return principal;
  if (
    !scopeAllows(principal.partnerScopes, body.partnerCode) ||
    !scopeAllows(principal.outScopes, body.outId)
  ) {
    return authError(
      403,
      'E_OPERATOR_SCOPE_DENIED',
      'operator is not scoped to the requested partner and out'
    );
  }
  return next();
}

/** Cancellation is always a live mutation; resource ownership is checked by the cancel service. */
export async function requireTradingCancelPrincipal(
  req: Request,
  next: () => Response | Promise<Response>,
  options: TradingAuthOptions = {}
): Promise<Response> {
  const body = (await readJsonObject(req)) ?? {};
  const principal = requirePrincipal(req, body, options);
  if (principal instanceof Response) return principal;
  return next();
}
