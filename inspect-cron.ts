const c = Bun.cron("0 0 1 1 *", () => {});
console.log("keys:", Object.keys(c));
console.log("dispose:", typeof c.dispose);
console.log("stop:", typeof c.stop);
console.log("Symbol.dispose:", typeof c[Symbol.dispose]);
console.log("ref:", typeof c.ref);
console.log("unref:", typeof c.unref);
if (typeof c.stop === "function") c.stop();
else if (typeof c.dispose === "function") c.dispose();
