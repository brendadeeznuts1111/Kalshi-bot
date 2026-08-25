#!/usr/bin/env bun
/**
 * `bun run client-shape:probe` — the server-backed client shapes (§160):
 * RedisClient (URL ctor + ~200 command methods + refused-connection
 * rejection), S3Client/S3File (BunFile-like + presign), Bun.postgres
 * (execute/values query API — NOT a pg template tag), FileSystemRouter
 * params/styles, password algorithms. Bun 1.4.0, no live servers.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1 RedisClient: URL ctor + command surface + refused rejection.
const rc = new Bun.RedisClient("redis://127.0.0.1:1");
const rp = Object.getOwnPropertyNames(Object.getPrototypeOf(rc));
check("P1 RedisClient command surface", rp.includes("get") && rp.includes("set") && rp.includes("hgetall") && rp.includes("publish") && rp.includes("subscribe") && rp.includes("xadd") && rp.includes("zadd") && rp.length > 150, "methods=" + rp.length);
let redisErr = "no-reject";
try { await rc.get("k"); } catch (e) { redisErr = "rejects:" + String((e as Error).message).slice(0, 30); }
check("P1a Redis refused-connection rejects", redisErr.startsWith("rejects:"), redisErr);

// P2 S3Client + S3File: BunFile-like surface + presign.
const s3 = new Bun.S3Client({ bucket: "x", accessKeyId: "k", secretAccessKey: "s" });
const s3p = Object.getOwnPropertyNames(Object.getPrototypeOf(s3));
const s3f = s3.file("a/b.txt");
const sfp = Object.getOwnPropertyNames(Object.getPrototypeOf(s3f));
check("P2 S3Client file API", s3p.includes("file") && s3p.includes("presign") && s3p.includes("delete") && s3p.includes("write") && sfp.includes("text") && sfp.includes("arrayBuffer") && sfp.includes("stat") && sfp.includes("presign"), "s3=" + s3p.slice(0, 8).join(",") + " file=" + sfp.slice(0, 8).join(","));
const pre = await s3.presign("a/b.txt", { expiresIn: 60 } as any);
check("P2a S3 presign URL generated", typeof pre === "string" && pre.includes("X-Amz-") && pre.includes("/x/a/b.txt"), String(pre).slice(0, 45));

// P3 Bun.postgres: query-builder API, NOT a pg template tag.
const pg = Bun.postgres("postgres://127.0.0.1:1/x");
const pgp = Object.getOwnPropertyNames(Object.getPrototypeOf(pg));
check("P3 postgres execute/values API", pgp.includes("execute") && pgp.includes("run") && pgp.includes("values") && pgp.includes("raw") && pgp.includes("simple") && typeof (pg as any).then === "function", pgp.slice(0, 10).join(","));
let pgErr = "no-reject";
try { await (pg as any).values("select 1"); } catch (e) { pgErr = "rejects:" + String((e as Error).message).slice(0, 30); }
check("P3a postgres query rejects on refused conn", pgErr.startsWith("rejects:"), pgErr);

// P4 FileSystemRouter params + dynamic kind.
const fsr = new Bun.FileSystemRouter({ dir: "scratch/meta-fixture", style: "nextjs" });
const m = fsr.match("/abc/page");
check("P4 FSR params {id} + dynamic", !!m && m.kind === "dynamic" && JSON.stringify(m!.params) === JSON.stringify({ id: "abc" }) && (fsr as any).style === "nextjs", "params=" + JSON.stringify(m!.params) + " kind=" + (m as any).kind);

// P5 password algorithm options.
const hA = await Bun.password.hash("pw", { algorithm: "argon2id" } as any);
const hB = await Bun.password.hash("pw", { algorithm: "bcrypt" } as any);
check("P5 password argon2id + bcrypt", hA.startsWith("$argon") && hB.startsWith("$2b$") && (await Bun.password.verify("pw", hA)) && (await Bun.password.verify("pw", hB)), hA.slice(0, 6) + " / " + hB.slice(0, 6));

const failed = results.filter((r) => !r.pass);
console.log("client-shape:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
