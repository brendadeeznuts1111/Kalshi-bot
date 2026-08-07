/** Bun-native provenance for WebView/Image visual-ground artifacts. */

export type BunWebViewOptions = NonNullable<
  ConstructorParameters<typeof Bun.WebView>[0]
>;
export type BunWebViewBackend = BunWebViewOptions["backend"];
export type BunImageMetadata = Awaited<ReturnType<Bun.Image["metadata"]>>;

export type SnapshotArtifactIntegrity = {
  path: string;
  sizeBytes: number;
  sha256: string;
};

export type VisualImageArtifactMeta = SnapshotArtifactIntegrity & {
  metadata: BunImageMetadata;
};

export type VisualSnapshotMeta = {
  schemaVersion: 1;
  capturedAt: string;
  runtime: {
    bunVersion: string;
    bunRevision: string;
  };
  webview: {
    available: boolean;
    attempted: boolean;
    captured: boolean;
    error: string | null;
    backend: "webkit" | "chrome";
    width: number;
    height: number;
  };
  image: {
    available: boolean;
    attempted: boolean;
    generated: boolean;
    error: string | null;
    source: VisualImageArtifactMeta | null;
    thumbnail: VisualImageArtifactMeta | null;
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
  webviewAttempted?: boolean;
  webviewError?: string | null;
  imageGenerated: boolean;
  imageAttempted?: boolean;
  imageError?: string | null;
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
      attempted: input.webviewAttempted ?? input.webviewCaptured,
      captured: input.webviewCaptured,
      error: input.webviewError ?? null,
      backend: normalizeWebViewBackend(input.backend),
      width: input.width,
      height: input.height,
    },
    image: {
      available: imageAvailable,
      attempted: input.imageAttempted ?? input.imageGenerated,
      generated: input.imageGenerated,
      error: input.imageError ?? null,
      source:
        imageAvailable && input.webviewCaptured
          ? await readImageArtifactMeta(input.sourcePath)
          : null,
      thumbnail:
        imageAvailable && input.imageGenerated
          ? await readImageArtifactMeta(input.thumbnailPath)
          : null,
    },
  };
}

export async function readArtifactIntegrity(
  path: string,
): Promise<SnapshotArtifactIntegrity | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const bytes = await file.bytes();
    return {
      path,
      sizeBytes: bytes.byteLength,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    };
  } catch {
    return null;
  }
}

async function readImageArtifactMeta(
  path: string,
): Promise<VisualImageArtifactMeta | null> {
  try {
    const [integrity, metadata] = await Promise.all([
      readArtifactIntegrity(path),
      Bun.file(path).image().metadata(),
    ]);
    return integrity ? { ...integrity, metadata } : null;
  } catch {
    return null;
  }
}
