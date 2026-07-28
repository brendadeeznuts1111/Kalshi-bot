# Bun Networking Verification — Multi-Target Report

- **Bun:** 1.4.0 (`a227ad9`)
- **Base:** http://127.0.0.1:3000
- **Elapsed:** 2101 ms
- **Result:** **36/36 pass** · 0 fail · 6 targets
- **HTTP request limit:** 256 (default)

## DNS Cache

| metric | value |
|---|---|
| cacheHitsCompleted | 4 |
| cacheHitsInflight | 4 |
| cacheMisses | 6 |
| size | 6 |
| errors | 0 |
| totalCount | 21 |

## Summary by Status

```json
{
  "total": 36,
  "passed": 36,
  "failed": 0,
  "info": 0,
  "skipped": 0,
  "byType": [
    {
      "type": "dns-prefetch",
      "label": "DNS Prefetch",
      "total": 6,
      "passed": 6,
      "failed": 0,
      "info": 0,
      "skipped": 0
    },
    {
      "type": "dns-cache",
      "label": "DNS Cache",
      "total": 6,
      "passed": 6,
      "failed": 0,
      "info": 0,
      "skipped": 0
    },
    {
      "type": "preconnect",
      "label": "Preconnect",
      "total": 6,
      "passed": 6,
      "failed": 0,
      "info": 0,
      "skipped": 0
    },
    {
      "type": "cold-fetch",
      "label": "Cold Fetch",
      "total": 6,
      "passed": 6,
      "failed": 0,
      "info": 0,
      "skipped": 0
    },
    {
      "type": "warm-fetch",
      "label": "Warm Fetch",
      "total": 6,
      "passed": 6,
      "failed": 0,
      "info": 0,
      "skipped": 0
    },
    {
      "type": "disk-write",
      "label": "Disk Write",
      "total": 3,
      "passed": 3,
      "failed": 0,
      "info": 0,
      "skipped": 0
    }
  ],
  "byCategory": [
    {
      "category": "ops",
      "total": 7,
      "passed": 7,
      "failed": 0
    },
    {
      "category": "registry",
      "total": 7,
      "passed": 7,
      "failed": 0
    },
    {
      "category": "dashboard",
      "total": 5,
      "passed": 5,
      "failed": 0
    },
    {
      "category": "pages",
      "total": 5,
      "passed": 5,
      "failed": 0
    },
    {
      "category": "trading",
      "total": 7,
      "passed": 7,
      "failed": 0
    },
    {
      "category": "control",
      "total": 5,
      "passed": 5,
      "failed": 0
    }
  ]
}
```


## By Optimization Type

```json
{
  "dns-prefetch": [
    {
      "target": "Health",
      "category": "ops",
      "type": "dns-prefetch",
      "metric": "0.469ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"127.0.0.1\", 3000)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "dns-prefetch",
      "metric": "0.015ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"127.0.0.1\", 3000)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "dns-prefetch",
      "metric": "0.018ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"dash.cloudflare.com\", 443)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "dns-prefetch",
      "metric": "0.037ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"registry.factory-wager.com\", 443)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "dns-prefetch",
      "metric": "0.034ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"api.elections.kalshi.com\", 443)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "dns-prefetch",
      "metric": "0.067ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"bun.com\", 443)",
      "optimization": "DNS Prefetch"
    }
  ],
  "dns-cache": [
    {
      "target": "Health",
      "category": "ops",
      "type": "dns-cache",
      "metric": "size=1 total=1",
      "status": "PASS",
      "detail": "hits=0 miss=1 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "dns-cache",
      "metric": "size=1 total=3",
      "status": "PASS",
      "detail": "hits=0 miss=1 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "dns-cache",
      "metric": "size=2 total=5",
      "status": "PASS",
      "detail": "hits=0 miss=2 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "dns-cache",
      "metric": "size=3 total=9",
      "status": "PASS",
      "detail": "hits=1 miss=3 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "dns-cache",
      "metric": "size=5 total=15",
      "status": "PASS",
      "detail": "hits=3 miss=5 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "dns-cache",
      "metric": "size=6 total=18",
      "status": "PASS",
      "detail": "hits=3 miss=6 err=0",
      "optimization": "DNS Cache"
    }
  ],
  "preconnect": [
    {
      "target": "Health",
      "category": "ops",
      "type": "preconnect",
      "metric": "tcp",
      "status": "PASS",
      "detail": "fetch.preconnect(http://127.0.0.1:3000)",
      "optimization": "Preconnect"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "preconnect",
      "metric": "tcp",
      "status": "PASS",
      "detail": "fetch.preconnect(http://127.0.0.1:3000)",
      "optimization": "Preconnect"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "preconnect",
      "metric": "dns-only",
      "status": "PASS",
      "detail": "fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://dash.cloudflare.com:443 ./app.ts (dns.prefetch host+port still applied)",
      "optimization": "Preconnect"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "preconnect",
      "metric": "dns-only",
      "status": "PASS",
      "detail": "fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://registry.factory-wager.com:443 ./app.ts (dns.prefetch host+port still applied)",
      "optimization": "Preconnect"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "preconnect",
      "metric": "dns-only",
      "status": "PASS",
      "detail": "fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://api.elections.kalshi.com:443 ./app.ts (dns.prefetch host+port still applied)",
      "optimization": "Preconnect"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "preconnect",
      "metric": "dns-only",
      "status": "PASS",
      "detail": "fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://bun.com:443 ./app.ts (dns.prefetch host+port still applied)",
      "optimization": "Preconnect"
    }
  ],
  "cold-fetch": [
    {
      "target": "Health",
      "category": "ops",
      "type": "cold-fetch",
      "metric": "6.6ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "cold-fetch",
      "metric": "0.8ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "cold-fetch",
      "metric": "481.2ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "cold-fetch",
      "metric": "553.1ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "cold-fetch",
      "metric": "60.1ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "cold-fetch",
      "metric": "223.5ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    }
  ],
  "warm-fetch": [
    {
      "target": "Health",
      "category": "ops",
      "type": "warm-fetch",
      "metric": "0.3ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "warm-fetch",
      "metric": "0.3ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "warm-fetch",
      "metric": "293.4ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "warm-fetch",
      "metric": "186.2ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "warm-fetch",
      "metric": "21.4ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "warm-fetch",
      "metric": "247.0ms (200)",
      "status": "PASS",
      "detail": "timing only — not a pool guarantee",
      "optimization": "Warm Fetch"
    }
  ],
  "response-text": [],
  "response-json": [],
  "response-formdata": [],
  "response-bytes": [],
  "response-arraybuffer": [],
  "response-blob": [],
  "disk-write": [
    {
      "target": "Health",
      "category": "ops",
      "type": "disk-write",
      "metric": "1.2ms",
      "status": "PASS",
      "detail": "/var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-ops-1784837603975.bin",
      "optimization": "Disk Write"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "disk-write",
      "metric": "0.3ms",
      "status": "PASS",
      "detail": "/var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-registry-1784837603978.bin",
      "optimization": "Disk Write"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "disk-write",
      "metric": "0.5ms",
      "status": "PASS",
      "detail": "/var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-trading-1784837605596.bin",
      "optimization": "Disk Write"
    }
  ],
  "buffer": [
    {
      "target": "Health",
      "category": "ops",
      "type": "buffer",
      "metric": "0.2ms (4584 B)",
      "status": "PASS"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "buffer",
      "metric": "0.5ms (17789 B)",
      "status": "PASS"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "buffer",
      "metric": "21.5ms (218 B)",
      "status": "PASS"
    }
  ]
}
```


## By Target Category

```json
{
  "ops": [
    {
      "target": "Health",
      "category": "ops",
      "type": "dns-prefetch",
      "metric": "0.469ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"127.0.0.1\", 3000)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Health",
      "category": "ops",
      "type": "dns-cache",
      "metric": "size=1 total=1",
      "status": "PASS",
      "detail": "hits=0 miss=1 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Health",
      "category": "ops",
      "type": "preconnect",
      "metric": "tcp",
      "status": "PASS",
      "detail": "fetch.preconnect(http://127.0.0.1:3000)",
      "optimization": "Preconnect"
    },
    {
      "target": "Health",
      "category": "ops",
      "type": "cold-fetch",
      "metric": "6.6ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Health",
      "category": "ops",
      "type": "warm-fetch",
      "metric": "0.3ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    },
    {
      "target": "Health",
      "category": "ops",
      "type": "buffer",
      "metric": "0.2ms (4584 B)",
      "status": "PASS"
    },
    {
      "target": "Health",
      "category": "ops",
      "type": "disk-write",
      "metric": "1.2ms",
      "status": "PASS",
      "detail": "/var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-ops-1784837603975.bin",
      "optimization": "Disk Write"
    }
  ],
  "registry": [
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "dns-prefetch",
      "metric": "0.015ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"127.0.0.1\", 3000)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "dns-cache",
      "metric": "size=1 total=3",
      "status": "PASS",
      "detail": "hits=0 miss=1 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "preconnect",
      "metric": "tcp",
      "status": "PASS",
      "detail": "fetch.preconnect(http://127.0.0.1:3000)",
      "optimization": "Preconnect"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "cold-fetch",
      "metric": "0.8ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "warm-fetch",
      "metric": "0.3ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "buffer",
      "metric": "0.5ms (17789 B)",
      "status": "PASS"
    },
    {
      "target": "Prediction report",
      "category": "registry",
      "type": "disk-write",
      "metric": "0.3ms",
      "status": "PASS",
      "detail": "/var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-registry-1784837603978.bin",
      "optimization": "Disk Write"
    }
  ],
  "dashboard": [
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "dns-prefetch",
      "metric": "0.018ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"dash.cloudflare.com\", 443)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "dns-cache",
      "metric": "size=2 total=5",
      "status": "PASS",
      "detail": "hits=0 miss=2 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "preconnect",
      "metric": "dns-only",
      "status": "PASS",
      "detail": "fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://dash.cloudflare.com:443 ./app.ts (dns.prefetch host+port still applied)",
      "optimization": "Preconnect"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "cold-fetch",
      "metric": "481.2ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "CF Dashboard",
      "category": "dashboard",
      "type": "warm-fetch",
      "metric": "293.4ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    }
  ],
  "pages": [
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "dns-prefetch",
      "metric": "0.037ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"registry.factory-wager.com\", 443)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "dns-cache",
      "metric": "size=3 total=9",
      "status": "PASS",
      "detail": "hits=1 miss=3 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "preconnect",
      "metric": "dns-only",
      "status": "PASS",
      "detail": "fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://registry.factory-wager.com:443 ./app.ts (dns.prefetch host+port still applied)",
      "optimization": "Preconnect"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "cold-fetch",
      "metric": "553.1ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Registry (Pages)",
      "category": "pages",
      "type": "warm-fetch",
      "metric": "186.2ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    }
  ],
  "trading": [
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "dns-prefetch",
      "metric": "0.034ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"api.elections.kalshi.com\", 443)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "dns-cache",
      "metric": "size=5 total=15",
      "status": "PASS",
      "detail": "hits=3 miss=5 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "preconnect",
      "metric": "dns-only",
      "status": "PASS",
      "detail": "fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://api.elections.kalshi.com:443 ./app.ts (dns.prefetch host+port still applied)",
      "optimization": "Preconnect"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "cold-fetch",
      "metric": "60.1ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "warm-fetch",
      "metric": "21.4ms (200)",
      "status": "PASS",
      "detail": "faster than cold (likely reuse)",
      "optimization": "Warm Fetch"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "buffer",
      "metric": "21.5ms (218 B)",
      "status": "PASS"
    },
    {
      "target": "Kalshi exchange",
      "category": "trading",
      "type": "disk-write",
      "metric": "0.5ms",
      "status": "PASS",
      "detail": "/var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-trading-1784837605596.bin",
      "optimization": "Disk Write"
    }
  ],
  "control": [
    {
      "target": "Bun docs",
      "category": "control",
      "type": "dns-prefetch",
      "metric": "0.067ms",
      "status": "PASS",
      "detail": "dns.prefetch(\"bun.com\", 443)",
      "optimization": "DNS Prefetch"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "dns-cache",
      "metric": "size=6 total=18",
      "status": "PASS",
      "detail": "hits=3 miss=6 err=0",
      "optimization": "DNS Cache"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "preconnect",
      "metric": "dns-only",
      "status": "PASS",
      "detail": "fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://bun.com:443 ./app.ts (dns.prefetch host+port still applied)",
      "optimization": "Preconnect"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "cold-fetch",
      "metric": "223.5ms (200)",
      "status": "PASS",
      "optimization": "Cold Fetch"
    },
    {
      "target": "Bun docs",
      "category": "control",
      "type": "warm-fetch",
      "metric": "247.0ms (200)",
      "status": "PASS",
      "detail": "timing only — not a pool guarantee",
      "optimization": "Warm Fetch"
    }
  ]
}
```


## All Checks (36)

| target | category | type | metric | status | detail | optimization |
|---|---|---|---|---|---|---|
| Health | ops | dns-prefetch | 0.469ms | PASS | dns.prefetch("127.0.0.1", 3000) | DNS Prefetch |
| Health | ops | dns-cache | size=1 total=1 | PASS | hits=0 miss=1 err=0 | DNS Cache |
| Health | ops | preconnect | tcp | PASS | fetch.preconnect(http://127.0.0.1:3000) | Preconnect |
| Health | ops | cold-fetch | 6.6ms (200) | PASS |  | Cold Fetch |
| Health | ops | warm-fetch | 0.3ms (200) | PASS | faster than cold (likely reuse) | Warm Fetch |
| Health | ops | buffer | 0.2ms (4584 B) | PASS |  |  |
| Health | ops | disk-write | 1.2ms | PASS | /var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-ops-1784837603975.bin | Disk Write |
| Prediction report | registry | dns-prefetch | 0.015ms | PASS | dns.prefetch("127.0.0.1", 3000) | DNS Prefetch |
| Prediction report | registry | dns-cache | size=1 total=3 | PASS | hits=0 miss=1 err=0 | DNS Cache |
| Prediction report | registry | preconnect | tcp | PASS | fetch.preconnect(http://127.0.0.1:3000) | Preconnect |
| Prediction report | registry | cold-fetch | 0.8ms (200) | PASS |  | Cold Fetch |
| Prediction report | registry | warm-fetch | 0.3ms (200) | PASS | faster than cold (likely reuse) | Warm Fetch |
| Prediction report | registry | buffer | 0.5ms (17789 B) | PASS |  |  |
| Prediction report | registry | disk-write | 0.3ms | PASS | /var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-registry-1784837603978.bin | Disk Write |
| CF Dashboard | dashboard | dns-prefetch | 0.018ms | PASS | dns.prefetch("dash.cloudflare.com", 443) | DNS Prefetch |
| CF Dashboard | dashboard | dns-cache | size=2 total=5 | PASS | hits=0 miss=2 err=0 | DNS Cache |
| CF Dashboard | dashboard | preconnect | dns-only | PASS | fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://dash.cloudflare.com:443 ./app.ts (dns.prefetch host+port still applied) | Preconnect |
| CF Dashboard | dashboard | cold-fetch | 481.2ms (200) | PASS |  | Cold Fetch |
| CF Dashboard | dashboard | warm-fetch | 293.4ms (200) | PASS | faster than cold (likely reuse) | Warm Fetch |
| Registry (Pages) | pages | dns-prefetch | 0.037ms | PASS | dns.prefetch("registry.factory-wager.com", 443) | DNS Prefetch |
| Registry (Pages) | pages | dns-cache | size=3 total=9 | PASS | hits=1 miss=3 err=0 | DNS Cache |
| Registry (Pages) | pages | preconnect | dns-only | PASS | fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://registry.factory-wager.com:443 ./app.ts (dns.prefetch host+port still applied) | Preconnect |
| Registry (Pages) | pages | cold-fetch | 553.1ms (200) | PASS |  | Cold Fetch |
| Registry (Pages) | pages | warm-fetch | 186.2ms (200) | PASS | faster than cold (likely reuse) | Warm Fetch |
| Kalshi exchange | trading | dns-prefetch | 0.034ms | PASS | dns.prefetch("api.elections.kalshi.com", 443) | DNS Prefetch |
| Kalshi exchange | trading | dns-cache | size=5 total=15 | PASS | hits=3 miss=5 err=0 | DNS Cache |
| Kalshi exchange | trading | preconnect | dns-only | PASS | fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://api.elections.kalshi.com:443 ./app.ts (dns.prefetch host+port still applied) | Preconnect |
| Kalshi exchange | trading | cold-fetch | 60.1ms (200) | PASS |  | Cold Fetch |
| Kalshi exchange | trading | warm-fetch | 21.4ms (200) | PASS | faster than cold (likely reuse) | Warm Fetch |
| Kalshi exchange | trading | buffer | 21.5ms (218 B) | PASS |  |  |
| Kalshi exchange | trading | disk-write | 0.5ms | PASS | /var/folders/26/vcnd_q_j4pv26q21n5zcn8qw0000gn/T/bun-net-trading-1784837605596.bin | Disk Write |
| Bun docs | control | dns-prefetch | 0.067ms | PASS | dns.prefetch("bun.com", 443) | DNS Prefetch |
| Bun docs | control | dns-cache | size=6 total=18 | PASS | hits=3 miss=6 err=0 | DNS Cache |
| Bun docs | control | preconnect | dns-only | PASS | fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect https://bun.com:443 ./app.ts (dns.prefetch host+port still applied) | Preconnect |
| Bun docs | control | cold-fetch | 223.5ms (200) | PASS |  | Cold Fetch |
| Bun docs | control | warm-fetch | 247.0ms (200) | PASS | timing only — not a pool guarantee | Warm Fetch |

## Rendered Tables

```
{
  "all": "┌────┬───────────────────┬──────────────┬──────────────┬─────────────────┬────────┐\n│    │ target            │ type         │ optimization │ metric          │ status │\n├────┼───────────────────┼──────────────┼──────────────┼─────────────────┼────────┤\n│  0 │ Health            │ dns-prefetch │ DNS Prefetch │ 0.469ms         │ PASS   │\n│  1 │ Health            │ dns-cache    │ DNS Cache    │ size=1 total=1  │ PASS   │\n│  2 │ Health            │ preconnect   │ Preconnect   │ tcp             │ PASS   │\n│  3 │ Health            │ cold-fetch   │ Cold Fetch   │ 6.6ms (200)     │ PASS   │\n│  4 │ Health            │ warm-fetch   │ Warm Fetch   │ 0.3ms (200)     │ PASS   │\n│  5 │ Health            │ buffer       │ undefined    │ 0.2ms (4584 B)  │ PASS   │\n│  6 │ Health            │ disk-write   │ Disk Write   │ 1.2ms           │ PASS   │\n│  7 │ Prediction report │ dns-prefetch │ DNS Prefetch │ 0.015ms         │ PASS   │\n│  8 │ Prediction report │ dns-cache    │ DNS Cache    │ size=1 total=3  │ PASS   │\n│  9 │ Prediction report │ preconnect   │ Preconnect   │ tcp             │ PASS   │\n│ 10 │ Prediction report │ cold-fetch   │ Cold Fetch   │ 0.8ms (200)     │ PASS   │\n│ 11 │ Prediction report │ warm-fetch   │ Warm Fetch   │ 0.3ms (200)     │ PASS   │\n│ 12 │ Prediction report │ buffer       │ undefined    │ 0.5ms (17789 B) │ PASS   │\n│ 13 │ Prediction report │ disk-write   │ Disk Write   │ 0.3ms           │ PASS   │\n│ 14 │ CF Dashboard      │ dns-prefetch │ DNS Prefetch │ 0.018ms         │ PASS   │\n│ 15 │ CF Dashboard      │ dns-cache    │ DNS Cache    │ size=2 total=5  │ PASS   │\n│ 16 │ CF Dashboard      │ preconnect   │ Preconnect   │ dns-only        │ PASS   │\n│ 17 │ CF Dashboard      │ cold-fetch   │ Cold Fetch   │ 481.2ms (200)   │ PASS   │\n│ 18 │ CF Dashboard      │ warm-fetch   │ Warm Fetch   │ 293.4ms (200)   │ PASS   │\n│ 19 │ Registry (Pages)  │ dns-prefetch │ DNS Prefetch │ 0.037ms         │ PASS   │\n│ 20 │ Registry (Pages)  │ dns-cache    │ DNS Cache    │ size=3 total=9  │ PASS   │\n│ 21 │ Registry (Pages)  │ preconnect   │ Preconnect   │ dns-only        │ PASS   │\n│ 22 │ Registry (Pages)  │ cold-fetch   │ Cold Fetch   │ 553.1ms (200)   │ PASS   │\n│ 23 │ Registry (Pages)  │ warm-fetch   │ Warm Fetch   │ 186.2ms (200)   │ PASS   │\n│ 24 │ Kalshi exchange   │ dns-prefetch │ DNS Prefetch │ 0.034ms         │ PASS   │\n│ 25 │ Kalshi exchange   │ dns-cache    │ DNS Cache    │ size=5 total=15 │ PASS   │\n│ 26 │ Kalshi exchange   │ preconnect   │ Preconnect   │ dns-only        │ PASS   │\n│ 27 │ Kalshi exchange   │ cold-fetch   │ Cold Fetch   │ 60.1ms (200)    │ PASS   │\n│ 28 │ Kalshi exchange   │ warm-fetch   │ Warm Fetch   │ 21.4ms (200)    │ PASS   │\n│ 29 │ Kalshi exchange   │ buffer       │ undefined    │ 21.5ms (218 B)  │ PASS   │\n│ 30 │ Kalshi exchange   │ disk-write   │ Disk Write   │ 0.5ms           │ PASS   │\n│ 31 │ Bun docs          │ dns-prefetch │ DNS Prefetch │ 0.067ms         │ PASS   │\n│ 32 │ Bun docs          │ dns-cache    │ DNS Cache    │ size=6 total=18 │ PASS   │\n│ 33 │ Bun docs          │ preconnect   │ Preconnect   │ dns-only        │ PASS   │\n│ 34 │ Bun docs          │ cold-fetch   │ Cold Fetch   │ 223.5ms (200)   │ PASS   │\n│ 35 │ Bun docs          │ warm-fetch   │ Warm Fetch   │ 247.0ms (200)   │ PASS   │\n└────┴───────────────────┴──────────────┴──────────────┴─────────────────┴────────┘\n",
  "byType": {
    "dns-prefetch": "┌───┬───────────────────┬──────────────┬──────────────┬─────────┬────────┐\n│   │ target            │ type         │ optimization │ metric  │ status │\n├───┼───────────────────┼──────────────┼──────────────┼─────────┼────────┤\n│ 0 │ Health            │ dns-prefetch │ DNS Prefetch │ 0.469ms │ PASS   │\n│ 1 │ Prediction report │ dns-prefetch │ DNS Prefetch │ 0.015ms │ PASS   │\n│ 2 │ CF Dashboard      │ dns-prefetch │ DNS Prefetch │ 0.018ms │ PASS   │\n│ 3 │ Registry (Pages)  │ dns-prefetch │ DNS Prefetch │ 0.037ms │ PASS   │\n│ 4 │ Kalshi exchange   │ dns-prefetch │ DNS Prefetch │ 0.034ms │ PASS   │\n│ 5 │ Bun docs          │ dns-prefetch │ DNS Prefetch │ 0.067ms │ PASS   │\n└───┴───────────────────┴──────────────┴──────────────┴─────────┴────────┘\n",
    "dns-cache": "┌───┬───────────────────┬───────────┬──────────────┬─────────────────┬────────┐\n│   │ target            │ type      │ optimization │ metric          │ status │\n├───┼───────────────────┼───────────┼──────────────┼─────────────────┼────────┤\n│ 0 │ Health            │ dns-cache │ DNS Cache    │ size=1 total=1  │ PASS   │\n│ 1 │ Prediction report │ dns-cache │ DNS Cache    │ size=1 total=3  │ PASS   │\n│ 2 │ CF Dashboard      │ dns-cache │ DNS Cache    │ size=2 total=5  │ PASS   │\n│ 3 │ Registry (Pages)  │ dns-cache │ DNS Cache    │ size=3 total=9  │ PASS   │\n│ 4 │ Kalshi exchange   │ dns-cache │ DNS Cache    │ size=5 total=15 │ PASS   │\n│ 5 │ Bun docs          │ dns-cache │ DNS Cache    │ size=6 total=18 │ PASS   │\n└───┴───────────────────┴───────────┴──────────────┴─────────────────┴────────┘\n",
    "preconnect": "┌───┬───────────────────┬────────────┬──────────────┬──────────┬────────┐\n│   │ target            │ type       │ optimization │ metric   │ status │\n├───┼───────────────────┼────────────┼──────────────┼──────────┼────────┤\n│ 0 │ Health            │ preconnect │ Preconnect   │ tcp      │ PASS   │\n│ 1 │ Prediction report │ preconnect │ Preconnect   │ tcp      │ PASS   │\n│ 2 │ CF Dashboard      │ preconnect │ Preconnect   │ dns-only │ PASS   │\n│ 3 │ Registry (Pages)  │ preconnect │ Preconnect   │ dns-only │ PASS   │\n│ 4 │ Kalshi exchange   │ preconnect │ Preconnect   │ dns-only │ PASS   │\n│ 5 │ Bun docs          │ preconnect │ Preconnect   │ dns-only │ PASS   │\n└───┴───────────────────┴────────────┴──────────────┴──────────┴────────┘\n",
    "cold-fetch": "┌───┬───────────────────┬────────────┬──────────────┬───────────────┬────────┐\n│   │ target            │ type       │ optimization │ metric        │ status │\n├───┼───────────────────┼────────────┼──────────────┼───────────────┼────────┤\n│ 0 │ Health            │ cold-fetch │ Cold Fetch   │ 6.6ms (200)   │ PASS   │\n│ 1 │ Prediction report │ cold-fetch │ Cold Fetch   │ 0.8ms (200)   │ PASS   │\n│ 2 │ CF Dashboard      │ cold-fetch │ Cold Fetch   │ 481.2ms (200) │ PASS   │\n│ 3 │ Registry (Pages)  │ cold-fetch │ Cold Fetch   │ 553.1ms (200) │ PASS   │\n│ 4 │ Kalshi exchange   │ cold-fetch │ Cold Fetch   │ 60.1ms (200)  │ PASS   │\n│ 5 │ Bun docs          │ cold-fetch │ Cold Fetch   │ 223.5ms (200) │ PASS   │\n└───┴───────────────────┴────────────┴──────────────┴───────────────┴────────┘\n",
    "warm-fetch": "┌───┬───────────────────┬────────────┬──────────────┬───────────────┬────────┐\n│   │ target            │ type       │ optimization │ metric        │ status │\n├───┼───────────────────┼────────────┼──────────────┼───────────────┼────────┤\n│ 0 │ Health            │ warm-fetch │ Warm Fetch   │ 0.3ms (200)   │ PASS   │\n│ 1 │ Prediction report │ warm-fetch │ Warm Fetch   │ 0.3ms (200)   │ PASS   │\n│ 2 │ CF Dashboard      │ warm-fetch │ Warm Fetch   │ 293.4ms (200) │ PASS   │\n│ 3 │ Registry (Pages)  │ warm-fetch │ Warm Fetch   │ 186.2ms (200) │ PASS   │\n│ 4 │ Kalshi exchange   │ warm-fetch │ Warm Fetch   │ 21.4ms (200)  │ PASS   │\n│ 5 │ Bun docs          │ warm-fetch │ Warm Fetch   │ 247.0ms (200) │ PASS   │\n└───┴───────────────────┴────────────┴──────────────┴───────────────┴────────┘\n",
    "disk-write": "┌───┬───────────────────┬────────────┬──────────────┬────────┬────────┐\n│   │ target            │ type       │ optimization │ metric │ status │\n├───┼───────────────────┼────────────┼──────────────┼────────┼────────┤\n│ 0 │ Health            │ disk-write │ Disk Write   │ 1.2ms  │ PASS   │\n│ 1 │ Prediction report │ disk-write │ Disk Write   │ 0.3ms  │ PASS   │\n│ 2 │ Kalshi exchange   │ disk-write │ Disk Write   │ 0.5ms  │ PASS   │\n└───┴───────────────────┴────────────┴──────────────┴────────┴────────┘\n",
    "buffer": "┌───┬───────────────────┬────────┬──────────────┬─────────────────┬────────┐\n│   │ target            │ type   │ optimization │ metric          │ status │\n├───┼───────────────────┼────────┼──────────────┼─────────────────┼────────┤\n│ 0 │ Health            │ buffer │ undefined    │ 0.2ms (4584 B)  │ PASS   │\n│ 1 │ Prediction report │ buffer │ undefined    │ 0.5ms (17789 B) │ PASS   │\n│ 2 │ Kalshi exchange   │ buffer │ undefined    │ 21.5ms (218 B)  │ PASS   │\n└───┴───────────────────┴────────┴──────────────┴─────────────────┴────────┘\n"
  },
  "byCategory": {
    "ops": "┌───┬────────┬──────────────┬──────────────┬────────────────┬────────┐\n│   │ target │ type         │ optimization │ metric         │ status │\n├───┼────────┼──────────────┼──────────────┼────────────────┼────────┤\n│ 0 │ Health │ dns-prefetch │ DNS Prefetch │ 0.469ms        │ PASS   │\n│ 1 │ Health │ dns-cache    │ DNS Cache    │ size=1 total=1 │ PASS   │\n│ 2 │ Health │ preconnect   │ Preconnect   │ tcp            │ PASS   │\n│ 3 │ Health │ cold-fetch   │ Cold Fetch   │ 6.6ms (200)    │ PASS   │\n│ 4 │ Health │ warm-fetch   │ Warm Fetch   │ 0.3ms (200)    │ PASS   │\n│ 5 │ Health │ buffer       │ undefined    │ 0.2ms (4584 B) │ PASS   │\n│ 6 │ Health │ disk-write   │ Disk Write   │ 1.2ms          │ PASS   │\n└───┴────────┴──────────────┴──────────────┴────────────────┴────────┘\n",
    "registry": "┌───┬───────────────────┬──────────────┬──────────────┬─────────────────┬────────┐\n│   │ target            │ type         │ optimization │ metric          │ status │\n├───┼───────────────────┼──────────────┼──────────────┼─────────────────┼────────┤\n│ 0 │ Prediction report │ dns-prefetch │ DNS Prefetch │ 0.015ms         │ PASS   │\n│ 1 │ Prediction report │ dns-cache    │ DNS Cache    │ size=1 total=3  │ PASS   │\n│ 2 │ Prediction report │ preconnect   │ Preconnect   │ tcp             │ PASS   │\n│ 3 │ Prediction report │ cold-fetch   │ Cold Fetch   │ 0.8ms (200)     │ PASS   │\n│ 4 │ Prediction report │ warm-fetch   │ Warm Fetch   │ 0.3ms (200)     │ PASS   │\n│ 5 │ Prediction report │ buffer       │ undefined    │ 0.5ms (17789 B) │ PASS   │\n│ 6 │ Prediction report │ disk-write   │ Disk Write   │ 0.3ms           │ PASS   │\n└───┴───────────────────┴──────────────┴──────────────┴─────────────────┴────────┘\n",
    "dashboard": "┌───┬──────────────┬──────────────┬──────────────┬────────────────┬────────┐\n│   │ target       │ type         │ optimization │ metric         │ status │\n├───┼──────────────┼──────────────┼──────────────┼────────────────┼────────┤\n│ 0 │ CF Dashboard │ dns-prefetch │ DNS Prefetch │ 0.018ms        │ PASS   │\n│ 1 │ CF Dashboard │ dns-cache    │ DNS Cache    │ size=2 total=5 │ PASS   │\n│ 2 │ CF Dashboard │ preconnect   │ Preconnect   │ dns-only       │ PASS   │\n│ 3 │ CF Dashboard │ cold-fetch   │ Cold Fetch   │ 481.2ms (200)  │ PASS   │\n│ 4 │ CF Dashboard │ warm-fetch   │ Warm Fetch   │ 293.4ms (200)  │ PASS   │\n└───┴──────────────┴──────────────┴──────────────┴────────────────┴────────┘\n",
    "pages": "┌───┬──────────────────┬──────────────┬──────────────┬────────────────┬────────┐\n│   │ target           │ type         │ optimization │ metric         │ status │\n├───┼──────────────────┼──────────────┼──────────────┼────────────────┼────────┤\n│ 0 │ Registry (Pages) │ dns-prefetch │ DNS Prefetch │ 0.037ms        │ PASS   │\n│ 1 │ Registry (Pages) │ dns-cache    │ DNS Cache    │ size=3 total=9 │ PASS   │\n│ 2 │ Registry (Pages) │ preconnect   │ Preconnect   │ dns-only       │ PASS   │\n│ 3 │ Registry (Pages) │ cold-fetch   │ Cold Fetch   │ 553.1ms (200)  │ PASS   │\n│ 4 │ Registry (Pages) │ warm-fetch   │ Warm Fetch   │ 186.2ms (200)  │ PASS   │\n└───┴──────────────────┴──────────────┴──────────────┴────────────────┴────────┘\n",
    "trading": "┌───┬─────────────────┬──────────────┬──────────────┬─────────────────┬────────┐\n│   │ target          │ type         │ optimization │ metric          │ status │\n├───┼─────────────────┼──────────────┼──────────────┼─────────────────┼────────┤\n│ 0 │ Kalshi exchange │ dns-prefetch │ DNS Prefetch │ 0.034ms         │ PASS   │\n│ 1 │ Kalshi exchange │ dns-cache    │ DNS Cache    │ size=5 total=15 │ PASS   │\n│ 2 │ Kalshi exchange │ preconnect   │ Preconnect   │ dns-only        │ PASS   │\n│ 3 │ Kalshi exchange │ cold-fetch   │ Cold Fetch   │ 60.1ms (200)    │ PASS   │\n│ 4 │ Kalshi exchange │ warm-fetch   │ Warm Fetch   │ 21.4ms (200)    │ PASS   │\n│ 5 │ Kalshi exchange │ buffer       │ undefined    │ 21.5ms (218 B)  │ PASS   │\n│ 6 │ Kalshi exchange │ disk-write   │ Disk Write   │ 0.5ms           │ PASS   │\n└───┴─────────────────┴──────────────┴──────────────┴─────────────────┴────────┘\n",
    "control": "┌───┬──────────┬──────────────┬──────────────┬─────────────────┬────────┐\n│   │ target   │ type         │ optimization │ metric          │ status │\n├───┼──────────┼──────────────┼──────────────┼─────────────────┼────────┤\n│ 0 │ Bun docs │ dns-prefetch │ DNS Prefetch │ 0.067ms         │ PASS   │\n│ 1 │ Bun docs │ dns-cache    │ DNS Cache    │ size=6 total=18 │ PASS   │\n│ 2 │ Bun docs │ preconnect   │ Preconnect   │ dns-only        │ PASS   │\n│ 3 │ Bun docs │ cold-fetch   │ Cold Fetch   │ 223.5ms (200)   │ PASS   │\n│ 4 │ Bun docs │ warm-fetch   │ Warm Fetch   │ 247.0ms (200)   │ PASS   │\n└───┴──────────┴──────────────┴──────────────┴─────────────────┴────────┘\n"
  },
  "typeSummary": "┌───┬──────────────┬──────────────┬───────┬────────┬────────┬──────┬─────────┐\n│   │ type         │ label        │ total │ passed │ failed │ info │ skipped │\n├───┼──────────────┼──────────────┼───────┼────────┼────────┼──────┼─────────┤\n│ 0 │ dns-prefetch │ DNS Prefetch │ 6     │ 6      │ 0      │ 0    │ 0       │\n│ 1 │ dns-cache    │ DNS Cache    │ 6     │ 6      │ 0      │ 0    │ 0       │\n│ 2 │ preconnect   │ Preconnect   │ 6     │ 6      │ 0      │ 0    │ 0       │\n│ 3 │ cold-fetch   │ Cold Fetch   │ 6     │ 6      │ 0      │ 0    │ 0       │\n│ 4 │ warm-fetch   │ Warm Fetch   │ 6     │ 6      │ 0      │ 0    │ 0       │\n│ 5 │ disk-write   │ Disk Write   │ 3     │ 3      │ 0      │ 0    │ 0       │\n└───┴──────────────┴──────────────┴───────┴────────┴────────┴──────┴─────────┘\n"
}
```

## Canonical API References

- **dnsPrefetching** — https://bun.com/docs/runtime/networking/fetch#dns-prefetching
- **dnsPrefetch** — https://bun.com/docs/runtime/networking/dns#dns-prefetch
- **dnsCacheStats** — https://bun.com/docs/runtime/networking/dns#dns-getcachestats
- **preconnect** — https://bun.com/docs/runtime/networking/fetch#preconnect-to-a-host
- **preconnectStartup** — https://bun.com/docs/runtime/networking/fetch#preconnect-at-startup
- **keepalive** — https://bun.com/docs/runtime/networking/fetch#connection-pooling-http-keep-alive
- **responseBuffering** — https://bun.com/docs/runtime/networking/fetch#response-buffering
- **write** — https://bun.com/docs/runtime/file-io#writing-files-bun-write
- **nanoseconds** — https://bun.com/docs/runtime/utils#bun-nanoseconds
- **inspectTable** — https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
- **env** — https://bun.com/docs/runtime/utils#bun-env
- **server** — https://bun.com/docs/runtime/http/server#reference
- **serverReload** — https://bun.com/docs/runtime/http/server#server-reload
- **serverStop** — https://bun.com/docs/runtime/http/server#server-stop
- **websockets** — https://bun.com/docs/runtime/http/websockets#start-a-websocket-server
- **tls** — https://bun.com/docs/runtime/http/tls
