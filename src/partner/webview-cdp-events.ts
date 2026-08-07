/** Chrome CDP wire shapes used with Bun.WebView.addEventListener<T>(). */

export type CdpWebSocketCreated = {
  url?: string;
  requestId?: string;
};

export type CdpWebSocketFrame = {
  response?: { payloadData?: string };
  requestId?: string;
};

export type CdpWebSocketClosed = {
  requestId?: string;
};

export function parseCdpWebSocketCreated(event: unknown): CdpWebSocketCreated {
  const value = webViewEventPayload(event);
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
  };
}

export function parseCdpWebSocketFrame(event: unknown): CdpWebSocketFrame {
  const value = webViewEventPayload(event);
  if (!isRecord(value)) return {};
  const response = isRecord(value.response) ? value.response : null;
  return {
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    ...(response && typeof response.payloadData === "string"
      ? { response: { payloadData: response.payloadData } }
      : {}),
  };
}

export function parseCdpWebSocketClosed(event: unknown): CdpWebSocketClosed {
  const value = webViewEventPayload(event);
  return isRecord(value) && typeof value.requestId === "string"
    ? { requestId: value.requestId }
    : {};
}

function webViewEventPayload(event: unknown): unknown {
  if (!isRecord(event)) return undefined;
  if ("data" in event) return event.data;
  if ("detail" in event) return event.detail;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
