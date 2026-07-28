# http

HTTP helpers for Bun.serve surfaces (static response utilities, caching headers).

| File | Role |
|------|------|
| [`fetch-client.ts`](fetch-client.ts) | Default custom headers on outbound `fetch` ([custom-headers](https://bun.com/docs/runtime/networking/fetch#custom-headers)) |
| [`fetch-preconnect.ts`](fetch-preconnect.ts) | DNS prefetch + fetch.preconnect warming |
| [`static-response.ts`](static-response.ts) | Buffered / file responses with ETag-friendly headers |
| [`content-type.ts`](content-type.ts) | Request/response Content-Type (Bun FormData/Blob auto CT) |
| [`form-upload.ts`](form-upload.ts) | FormData file receive/send (`req.formData` + `Bun.write`) |
| [`data-etag.ts`](data-etag.ts) | Shared ETag for JSON health/summary bodies |
| [`live-reload.ts`](live-reload.ts) | Local SSE browser live-reload + HTML inject (serve-public HMR) |

### Content-Type (separated columns)

Canonical: [content-type-handling](https://bun.com/docs/runtime/networking/fetch#content-type-handling)

Every decision is a four-column row:

| Column | Meaning |
|--------|---------|
| **defaultValue** | Bun auto CT when header omitted (`multipart/form-data`, `blob.type`, or `—`) |
| **ourValue** | What we set explicitly, or `—` if we defer to Bun |
| **expected** | Contract for this surface |
| **status** | `ok` · `mismatch` · `missing` · `override` · `defer` |

```bash
bun tools/content-type-table.ts          # Bun.inspect.table
bun tools/content-type-table.ts --json
```

| Body | defaultValue | ourValue | expected | status |
|------|--------------|----------|----------|--------|
| `FormData` | multipart + boundary | `—` (never set) | multipart | ok |
| `FormData` + manual CT | multipart | multipart | multipart | **override** (bad) |
| `Blob` / `File` | `blob.type` | `—` | media type | ok |
| JSON `string` | `—` | `application/json; charset=utf-8` | application/json | ok |
| Response `.json` path | `—` | `application/json; charset=utf-8` | same | ok |

API: `decideRequestContentType`, `decideResponseContentType`, `evaluateContentType`, `contentTypePolicyCatalog`.

### File uploads (FormData)

Canonical: [file-uploads](https://bun.com/docs/guides/http/file-uploads#upload-files-via-http-using-formdata)

```ts
// receive
const form = await req.formData();
const pic = form.get("profilePicture"); // Blob
await Bun.write("profilePicture.png", pic);

// send (no Content-Type header)
const form = new FormData();
form.set("file", blob, "artifact.tgz");
await fetch(url, { method: "POST", body: form, headers: { Authorization: "…" } });
```

Helpers: `requireFormBlob`, `writeFormBlob`, `buildFileUploadForm` in `form-upload.ts`.

### Outbound fetch (custom headers)

Canonical: [custom-headers](https://bun.com/docs/runtime/networking/fetch#custom-headers)

```ts
import { factoryFetch, installGlobalFetchHeaders, mergeFetchHeaders } from "../lib/http/fetch-client.ts";

installGlobalFetchHeaders(); // optional — patches global fetch once per process
await factoryFetch(url, { headers: mergeFetchHeaders({ Accept: "application/json" }) });
```

Default headers: `User-Agent: FactoryWager/fetch (Bun/…)`, `Accept-Language: en`. Caller headers override.
