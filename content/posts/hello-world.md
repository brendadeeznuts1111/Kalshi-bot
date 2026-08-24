---
slug: hello-world
title: Hello, Content Pipeline
date: 2026-08-20
tags: [content, hashing]
---
# Hello

![Brand card](./assets/brand-card.png)

This post flows through the content pipeline: Bun.file -> frontmatter ->
SHA-256 hash -> ETag/304 conditional GET.

- Zero dependencies
- Content-addressed ETags
- Probe-verified APIs
