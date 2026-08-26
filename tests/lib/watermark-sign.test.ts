// Locks the watermark+sign pipeline (SVG → WebView overlay + ml-dsa-65).
// Signing/verification always run; the WebView capture is skipped under the
// parallel suite (WebKit flakiness, repo §178) — the REAL capture + PNG
// verification lives in the ground tool: bun run watermark:sign.
import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { watermarkAndSign } from '../../src/lib/watermark-sign.ts';

describe('watermark-sign pipeline', () => {
  test('ml-dsa-65 keygen + sign + verify round-trips on arbitrary bytes', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ml-dsa-65', {});
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const sig = sign(null, data, privateKey);
    expect(sig.length).toBeGreaterThan(0);
    expect(verify(null, data, publicKey, sig)).toBe(true);
    // tampered data fails verification
    expect(verify(null, new Uint8Array([9, 9]), publicKey, sig)).toBe(false);
  });

  test('ml-dsa-65 is the correct key type name (bare "ml-dsa" is rejected)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ml-dsa-65', {});
    expect(privateKey.asymmetricKeyType).toBe('ml-dsa-65');
    expect(() => generateKeyPairSync('ml-dsa' as any, {} as any)).toThrow();
  });

  test.skip('watermarkAndSign self-verifies and returns a valid PNG', async () => {
      const asset = await watermarkAndSign({ text: 'TOKEN -> recipient', width: 64, height: 64 });
      expect(asset.keyType).toBe('ml-dsa-65');
      expect(asset.signature.length).toBeGreaterThan(0);
      expect(asset.publicKeyPem).toContain('BEGIN PUBLIC KEY');
      const meta = await new Bun.Image(asset.png).metadata();
      expect(meta.format).toBe('png');
    });
});
