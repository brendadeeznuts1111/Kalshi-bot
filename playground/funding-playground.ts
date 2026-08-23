import { loadKalshiCredentials, kalshiAccessHeaders, type KalshiCredentials } from '../src/bot/kalshi-auth.ts';
import { KALSHI_REST_BASE, resolveKalshiEnvironment } from '../src/bot/kalshi-client.ts';

const env = resolveKalshiEnvironment();
const base = KALSHI_REST_BASE[env];
let creds: KalshiCredentials | undefined;
try {
  creds = await loadKalshiCredentials();
} catch (e) {
  console.warn('Kalshi credentials not loaded:', e instanceof Error ? e.message : String(e));
}

const htmlPath = `${import.meta.dir}/funding-playground.html`;
const jsPath = `${import.meta.dir}/funding-playground.js`;

async function kalshiGet(path: string, query = '', attempt = 0): Promise<unknown> {
  if (!creds) {
    throw new Error('Kalshi credentials not loaded. Set KALSHI_API_KEY_ID and KALSHI_API_PRIVATE_KEY.');
  }
  const headers = kalshiAccessHeaders(creds, 'GET', path);
  const url = `${base}${path}${query ? `?${query}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
    });
  } catch (e) {
    if (attempt === 0) {
      return kalshiGet(path, query, attempt + 1);
    }
    throw new Error(`Kalshi ${path} network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status >= 500 && attempt === 0) {
    await new Promise((r) => setTimeout(r, 500));
    return kalshiGet(path, query, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Kalshi ${path}: ${res.status} - invalid or missing credentials.`);
    }
    throw new Error(`Kalshi ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchAll(path: string) {
  const key = path.endsWith('withdrawals') ? 'withdrawals' : 'deposits';
  const all: unknown[] = [];
  let cursor: string | undefined;
  do {
    const q = cursor ? `cursor=${encodeURIComponent(cursor)}&limit=500` : 'limit=500';
    const json = (await kalshiGet(path, q)) as Record<string, unknown>;
    const page = Array.isArray(json[key]) ? (json[key] as unknown[]) : [];
    all.push(...page);
    cursor = typeof json.cursor === 'string' ? json.cursor : undefined;
  } while (cursor);
  return all;
}

export async function handleRequest(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (pathname === '/') {
    const html = await Bun.file(htmlPath).text();
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  if (pathname === '/funding-playground.js') {
    return new Response(Bun.file(jsPath), { headers: { 'Content-Type': 'application/javascript' } });
  }

  if (pathname === '/api/env') {
    return Response.json({ env, base });
  }

  if (pathname === '/api/health') {
    return Response.json({ status: 'ok', env, base, credentialsLoaded: !!creds });
  }

  if (pathname === '/api/deposits') {
    return Response.json(await fetchAll('/portfolio/deposits'));
  }

  if (pathname === '/api/withdrawals') {
    return Response.json(await fetchAll('/portfolio/withdrawals'));
  }

  return new Response('Not found', { status: 404 });
}

if (import.meta.main) {
  const port = Bun.env.PLAYGROUND_PORT ? Number(Bun.env.PLAYGROUND_PORT) : 4234;
  const server = Bun.serve({
    port,
    // Bun.serve fetch Request type is Bun's own Request, which differs from global Request.
    fetch: handleRequest as any,
  });
  console.log(`Funding playground running at http://localhost:${server.port}`);
}