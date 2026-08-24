---
slug: etag-patterns
title: ETag & Conditional GET Patterns
date: 2026-08-24
tags: [http, caching]
---
# ETag & Conditional GET

The ETag is the quoted content hash. Clients send `If-None-Match` and the
server answers 304 when it matches — verified in-repo via the notModified
helper (`src/research/serve.ts`) and the /brand routes.

## How the ETag is derived

The ETag is the quoted SHA-256 of the RAW file (frontmatter included) —
content-addressed, deterministic, and immutable for a given file.

## Conditional GET flow

1. Client sends `If-None-Match: "<hash>"`
2. Server re-hashes the file
3. Match → `304 Not Modified` (no body)
4. Mismatch → `200` + new ETag
