#!/usr/bin/env bun
/**
 * surface-confirm-probe.ts - the CONFIRMATION PROTOCOL (S224):
 * never conclude an API is broken/absent from spec-shaped calls alone.
 * Protocol: (1) DUMP the runtime surface (names, arity) - anchors are
 * discovered, not assumed; (2) derive the call shape from the binding's
 * OWN error text (parameter names reveal arg order); (3) lock a POSITIVE
 * round-trip with assertions - scratch negatives are not confirmation.
 *
 * This probe applies the protocol to crypto.subtle's ML-KEM surface -
 * the API that S221 wrongly declared 'unusable' because the probe read
 * property 'sharedSecret' instead of 'sharedKey' and assumed spec arg
 * order. Superseded by S223.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  - ' + detail : '')); };

const subtle = crypto.subtle as any;

// STEP 1: surface dump - names + arity (anchors discovered, not assumed).
const proto = Object.getPrototypeOf(subtle);
const names = Object.getOwnPropertyNames(proto).sort();
const kemMethods = names.filter((n) => /encapsulate|decapsulate/i.test(n));
check('surface: KEM methods exist on crypto.subtle', kemMethods.length >= 4, kemMethods.join(','));
for (const n of kemMethods) {
  check('arity: ' + n + ' length=' + (subtle[n] as Function).length, true);
}

// STEP 2: generate with the usage strings the surface accepts (Bits variant).
const kp: any = await subtle.generateKey({ name: 'ml-kem-768' }, true, ['encapsulateBits', 'decapsulateBits']);
check('keygen: ml-kem-768 with Bits usages', !!kp.publicKey && !!kp.privateKey);

// STEP 3: encapsulate - derive result shape from the ACTUAL return (not a guessed property).
const enc: any = await subtle.encapsulateBits({ name: 'ml-kem-768' }, kp.publicKey);
const encKeys = Object.keys(enc).sort();
check('encapsulate returns ciphertext', !!enc.ciphertext && enc.ciphertext.byteLength === 1088, 'ct=' + enc.ciphertext?.byteLength + 'B');
const sharedProp = encKeys.find((k) => /shared/i.test(k));
check('encapsulate shared-secret property found by name', !!sharedProp, 'keys=' + encKeys.join(',') + ' prop=' + sharedProp);
check('shared secret is 32 bytes', !!sharedProp && enc[sharedProp as string].byteLength === 32, 'len=' + (sharedProp ? enc[sharedProp as string].byteLength : 'n/a'));

// STEP 4: decapsulate with (algorithm, key, ciphertext) - arg order from the binding's error text.
const dec: ArrayBuffer = await subtle.decapsulateBits({ name: 'ml-kem-768' }, kp.privateKey, enc.ciphertext);
const sharedBuf: ArrayBuffer = sharedProp ? enc[sharedProp as string] : new ArrayBuffer(0);
const a = new Uint8Array(sharedBuf);
const b = new Uint8Array(dec);
const match = a.length === b.length && a.every((v, i) => v === b[i]);
check('decapsulate round-trip shared key matches', match, 'dec=' + dec.byteLength + 'B');

const failed = results.filter((r) => !r.pass);
console.log('surface-confirm: ' + (results.length - failed.length) + '/' + results.length + ' pass');
if (failed.length) { console.error('FAILED: ' + failed.map((f) => f.name).join('; ')); process.exit(1); }
process.exit(0);

export {};
