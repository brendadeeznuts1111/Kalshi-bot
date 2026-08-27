# Symbol.dispose / using / await using — probe-verified

**Sources:** [bun-v1.2](https://bun.com/blog/bun-v1.2#resource-management-with-using)
(resource management with `using`) · [bun-v1.1.8](https://bun.com/blog/bun-v1.1.8#new-support-for-symbol-dispose-in-bun-apis)
(`Symbol.dispose` in Bun APIs) · [bun-v1.3](https://bun.com/blog/bun-v1.3#disposablestack-and-asyncdisposablestack)
(`DisposableStack`/`AsyncDisposableStack`) · probe-verified on bun 1.4.0 (34cbb9a40).
Legend: ✅ verified · ⚠️ partial / different from the claim · ❌ not supported.

## 1. Language support — ✅ complete

- Globals: `Symbol.dispose`, `Symbol.asyncDispose`, `DisposableStack`,
  `AsyncDisposableStack`, `SuppressedError` — all present on 1.4.0.
- `using` and `await using` declarations parse and run (probe: a custom
  `[Symbol.dispose]` runs at scope exit; `[Symbol.asyncDispose]` runs after the
  async scope).

## 2. Disposable Bun APIs — verified matrix

| API | Disposable? | Evidence (1.4.0) |
| --- | --- | --- |
| `Bun.serve()` | ✅ | In-scope fetch → `"hi"`; after scope exit → `ConnectionRefused` (server actually stopped) |
| `Bun.listen()` | ✅ | `[Symbol.dispose]` is a function |
| `bun:sqlite` `Database` | ✅ | Dispose closes the DB (queries after → throw) |
| `Database.prepare()` / `Database.query()` | ✅ | Dispose finalizes the statement: `.run()` after → `"Statement has finalized"` |
| `Bun.WebView` | ✅ (+ asyncDispose) | Prototype has both; bun-types: "Alias for close. Enables `using view = new Bun.WebView(...)`" (macOS) |
| `mock()` / `spyOn()` (bun:test) | ✅ | Dispose restores: mock call after → `undefined` |
| `Bun.Terminal` | ✅ asyncDispose (types) | bun-types: "Close the terminal... Async dispose for use with `await using`" (not GUI-probed) |

```ts
{
  using server = Bun.serve({ port: 0, fetch: () => new Response("Hello") });
  // server.stop() runs automatically at scope exit — verified
}
```

## 3. Claims that do NOT hold on 1.4.0

| Claim | Reality |
| --- | --- |
| `Bun.spawn()` — auto-close on scope exit | ❌ **no `[Symbol.dispose]`** on the returned `Subprocess`. `using proc = Bun.spawn([...])` throws `"@@dispose must not be undefined or null"`. Use `try/finally` + `proc.kill()`. |
| `Bun.connect()` — auto-close on scope exit | ⚠️ the **return value** has no dispose (`using` throws). The socket object delivered to the `open`/`data` callbacks *does* have `[Symbol.dispose]` (bun-types docstring: "socket.end() is called automatically when exiting the scope") — but you cannot `using` the `Bun.connect()` result itself. |
| `sql.reserve()` — auto-releases connection | ❌ **phantom API** — `Database.reserve` does not exist on 1.4.0 (runtime `undefined`, no declaration in `bun-types`). |
| (bonus) `Database.transaction()` | ❌ no dispose (observed). |

## 4. DisposableStack / AsyncDisposableStack — ✅ LIFO

```ts
{
  using stack = new DisposableStack();
  stack.use(a);
  stack.use(b);
  stack.defer(() => { /* ... */ });
  // on scope exit: deferred → b → a (reverse order) — verified
}
```

Probe: `use(a); use(b); defer(d)` → dispose order `["d", "b", "a"]`.

## 5. Custom classes — ✅

```ts
class Resource {
  [Symbol.dispose]() { /* cleanup */ }
}
using resource = new Resource();
```

Verified: `[Symbol.dispose]` is invoked at scope end; `[Symbol.asyncDispose]`
with `await using`. Note: a non-disposable value in a `using` declaration
throws at scope exit (`"@@dispose must not be undefined or null"`).

## 6. Summary

| Claim | Verdict |
| --- | --- |
| `using` / `await using` syntax | ✅ |
| `Symbol.dispose`/asyncDispose/DisposableStack/AsyncDisposableStack globals | ✅ |
| `Bun.serve()` auto-stop | ✅ |
| `Bun.spawn()` auto-close | ❌ |
| `Bun.connect()` auto-close (return value) | ⚠️ not on the return; socket in callbacks is |
| `bun:sqlite` Database + statements | ✅ |
| `sql.reserve()` | ❌ phantom |
| `Bun.WebView` | ✅ (macOS; prototype dispose+asyncDispose) |
| `mock()` / `spyOn()` auto-restore | ✅ |
| DisposableStack LIFO | ✅ |

**Docs:** https://bun.com/docs/runtime/using · https://bun.com/docs/test/mocks
· https://bun.com/docs/api/sqlite · https://bun.com/docs/api/webview
