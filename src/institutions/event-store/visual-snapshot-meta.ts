/** Bun-native provenance for WebView/Image visual-ground artifacts. */

export type BunWebViewOptions = NonNullable<
  ConstructorParameters<typeof Bun.WebView>[0]
>;
export type BunWebViewBackend = BunWebViewOptions["backend"];
export type BunImageMetadata = Awaited<ReturnType<Bun.Image["metadata"]>>;

export type VisualSnapshotMeta = {
  schemaVersion: 1;
  capturedAt: string;
  runtime: {
    bunVersion: string;
    bunRevision: string;
  };
  webview: {
    available: boolean;
    captured: boolean;
    backend: "webkit" | "chrome";
    width: number;
    height: number;
  };
  image: {
    available: boolean;
    generated: boolean;
    source: BunImageMetadata | null;
    thumbnail: BunImageMetadata | null;
  };
};

export function normalizeWebViewBackend(
  backend: BunWebViewBackend,
): "webkit" | "chrome" {
  return typeof backend === "object" ? backend.type : (backend ?? "webkit");
}

export async function buildVisualSnapshotMeta(input: {
  capturedAt: string;
  backend: BunWebViewBackend;
  width: number;
  height: number;
  webviewCaptured: boolean;
  imageGenerated: boolean;
  sourcePath: string;
  thumbnailPath: string;
}): Promise<VisualSnapshotMeta> {
  const imageAvailable = typeof Bun.Image === "function";
  return {
    schemaVersion: 1,
    capturedAt: input.capturedAt,
    runtime: {
      bunVersion: Bun.version,
      bunRevision: Bun.revision,
    },
    webview: {
      available: typeof Bun.WebView === "function",
      captured: input.webviewCaptured,
      backend: normalizeWebViewBackend(input.backend),
      width: input.width,
      height: input.height,
    },
    image: {
      available: imageAvailable,
      generated: input.imageGenerated,
      source:
        imageAvailable && input.webviewCaptured
          ? await readImageMetadata(input.sourcePath)
          : null,
      thumbnail:
        imageAvailable && input.imageGenerated
          ? await readImageMetadata(input.thumbnailPath)
          : null,
    },
  };
}

async function readImageMetadata(path: string): Promise<BunImageMetadata | null> {
  try {
    return await Bun.file(path).image().metadata();
  } catch {
    return null;
  }
}
