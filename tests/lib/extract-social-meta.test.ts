// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/guides/html-rewriter/extract-social-meta#extract-social-share-images-and-open-graph-tags
import { describe, expect, test } from "bun:test";
import {
  extractSocialMetadataFromHtml,
  normalizeSocialKey,
} from "../../src/lib/extract-social-meta.ts";

const FULL_HTML = `<!doctype html>
<html>
<head>
  <title>Fallback Title</title>
  <meta property="og:title" content="OG Title" />
  <meta property="og:description" content="OG Description" />
  <meta property="og:image" content="/share.png" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Example" />
  <meta name="twitter:title" content="Twitter Title" />
  <meta name="description" content="Meta description" />
</head>
<body></body>
</html>`;

describe("extract-social-meta (HTMLRewriter)", () => {
  test("normalizeSocialKey maps site_name → siteName", () => {
    expect(normalizeSocialKey("site_name")).toBe("siteName");
    expect(normalizeSocialKey("image")).toBe("image");
    expect(normalizeSocialKey("unknown")).toBeUndefined();
  });

  test("extracts OG tags and absolutizes image", async () => {
    const meta = await extractSocialMetadataFromHtml(FULL_HTML, "https://example.com/page");
    expect(meta.title).toBe("OG Title");
    expect(meta.description).toBe("OG Description");
    expect(meta.image).toBe("https://example.com/share.png");
    expect(meta.type).toBe("website");
    expect(meta.siteName).toBe("Example");
  });

  test("falls back to title and description meta", async () => {
    const html = `<html><head>
      <title>Page Title</title>
      <meta name="description" content="Desc only" />
    </head></html>`;
    const meta = await extractSocialMetadataFromHtml(html);
    expect(meta.title).toBe("Page Title");
    expect(meta.description).toBe("Desc only");
  });

  test("Twitter used only when OG missing", async () => {
    const html = `<html><head>
      <meta name="twitter:title" content="Tw Title" />
      <meta name="twitter:image" content="https://cdn.example/tw.jpg" />
    </head></html>`;
    const meta = await extractSocialMetadataFromHtml(html);
    expect(meta.title).toBe("Tw Title");
    expect(meta.image).toBe("https://cdn.example/tw.jpg");
  });
});
