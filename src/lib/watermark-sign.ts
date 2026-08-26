/**
 * watermark-sign.ts — watermark an image via SVG → Bun.WebView, then sign the
 * result with an ML-DSA (post-quantum) key from node:crypto.
 *
 * Verified on Bun 1.4.0:
 *   - Bun has NO Canvas/2D API (img.canvas is undefined, probe-verified) —
 *     text overlay therefore goes through SVG rendered in Bun.WebView (the
 *     brand-card pattern: data: URL, WebKit, settle+retry).
 *   - node:crypto key types are ml-dsa-44 / ml-dsa-65 / ml-dsa-87 (NOT
 *     "ml-dsa" — probe-verified); modulusLength is RSA-only (ignored).
 *   - sign(null, data, privateKey) + verify round-trip works (3,309 B sig
 *     at ml-dsa-65).
 *
 * @see https://bun.com/docs/guides/webview (headless browser, screenshot() -> Blob)
 * @see https://nodejs.org/api/crypto.html (asymmetric key types incl. ML-DSA)
 */
import { sign, verify, generateKeyPairSync, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { getSecret, setSecret, type SecretBackend } from './secrets.ts';
import { secretPolicy } from './secret-registry.ts';

export type WatermarkOptions = {
  /** Watermark text (token → recipient). XML-escaped before embedding. */
  text: string;
  /** Output width in px. */
  width?: number;
  /** Output height in px. */
  height?: number;
  /** Optional background image as a data: URL (e.g. a fetched logo). */
  imageDataUrl?: string;
};

export type SignedAsset = {
  png: Uint8Array;
  signature: Uint8Array;
  publicKeyPem: string;
  keyType: 'ml-dsa-44' | 'ml-dsa-65' | 'ml-dsa-87';
};

const escXml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Build the SVG (image + watermark text) as an HTML data: URL for WebView. */
function watermarkHtml(opts: WatermarkOptions): string {
  const w = opts.width ?? 400;
  const h = opts.height ?? 400;
  const img = opts.imageDataUrl
    ? '<image href="' + opts.imageDataUrl + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid meet"/>'
    : '';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<rect width="100%" height="100%" fill="#0b0e14"/>' +
    img +
    '<rect x="0" y="' + (h - 34) + '" width="100%" height="34" fill="rgba(0,0,0,0.55)"/>' +
    '<text x="12" y="' + (h - 12) + '" font-family="system-ui, sans-serif" font-size="15" fill="rgba(255,255,255,0.9)">' +
    escXml(opts.text) +
    '</text></svg>';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#0b0e14}</style></head><body>' + svg + '</body></html>';
}

/** Rasterize the watermarked SVG via Bun.WebView → PNG bytes (settle+retry). */
export async function watermarkPng(opts: WatermarkOptions): Promise<Uint8Array | null> {
  if (typeof Bun.WebView !== 'function') return null;
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(watermarkHtml(opts));
  type WebViewOpts = NonNullable<ConstructorParameters<typeof Bun.WebView>[0]>;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await using view = new Bun.WebView({
        width: opts.width ?? 400,
        height: opts.height ?? 400,
        backend: process.platform === 'darwin' ? 'webkit' : 'chrome',
        url: dataUrl,
      } as WebViewOpts);
      await new Promise((r) => setTimeout(r, 400 + attempt * 300));
      const shot = await view.screenshot();
      return new Uint8Array(await (shot as Blob).arrayBuffer());
    } catch {
      // transient WebKit contention — retry
    }
  }
  return null;
}

/**
 * Persistent ML-DSA-65 watermark signing key (S220): get-or-create from the
 * OS vault (Bun.secrets) via the typed SECRET_REGISTRY entry. Previously the
 * key was regenerated per call - signatures were unverifiable afterwards.
 * Falls back to env (WATERMARK_MLDSA_PRIVATE_KEY) then generates + stores.
 * Never takes the key from argv (registry policy: vault+env only).
 */
export async function watermarkKey(
  opts: { keyType?: 'ml-dsa-44' | 'ml-dsa-65' | 'ml-dsa-87'; service?: string; backend?: SecretBackend } = {},
): Promise<{ privateKey: KeyObject; publicKeyPem: string; keyType: 'ml-dsa-44' | 'ml-dsa-65' | 'ml-dsa-87' }> {
  const keyType = opts.keyType ?? 'ml-dsa-65';
  const policy = secretPolicy('watermark-mldsa-key');
  const service = opts.service ?? policy.service;
  const stored = opts.backend !== undefined
    ? await getSecret({ service, name: policy.name }, { backend: opts.backend })
    : policy.envName !== undefined
      ? await getSecret({ service, name: policy.name }, { envName: policy.envName })
      : await getSecret({ service, name: policy.name });
  if (stored) {
    const privateKey = createPrivateKey(stored);
    return {
      privateKey,
      publicKeyPem: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) as string,
      keyType: privateKey.asymmetricKeyType as 'ml-dsa-44' | 'ml-dsa-65' | 'ml-dsa-87',
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync(keyType, {});
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  await setSecret({ service, name: policy.name, value: privatePem }, opts.backend);
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    keyType,
  };
}

/**
 * Watermark + sign in one pipeline: SVG+WebView → PNG → ML-DSA-65 signature
 * with the PERSISTENT registered key (S220). Self-verifies before returning.
 */
export async function watermarkAndSign(opts: WatermarkOptions & { keyType?: 'ml-dsa-44' | 'ml-dsa-65' | 'ml-dsa-87' }): Promise<SignedAsset> {
  const png = await watermarkPng(opts);
  if (!png) throw new Error('watermark: WebView unavailable or capture failed');
  const keyType = opts.keyType ?? 'ml-dsa-65';
  const { privateKey, publicKeyPem } = await watermarkKey({ keyType });
  const signature = sign(null, png, privateKey);
  if (!verify(null, png, createPrivateKey(publicKeyPem), signature)) {
    throw new Error('watermark: ML-DSA signature self-verify failed');
  }
  return {
    png,
    signature,
    publicKeyPem,
    keyType,
  };
}
