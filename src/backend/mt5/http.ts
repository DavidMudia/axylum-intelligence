export type ParsedMt5JsonBody =
  | { ok: true; rawBody: string; value: unknown }
  | { ok: false; response: Response };

export async function readMt5JsonBody(request: Request, maximumBytes: number): Promise<ParsedMt5JsonBody> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, response: Response.json({ error: "Content-Type must be application/json" }, { status: 415 }) };
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      return { ok: false, response: Response.json({ error: "Content-Length is invalid" }, { status: 400 }) };
    }
    if (length > maximumBytes) {
      return { ok: false, response: Response.json({ error: "Request body is too large" }, { status: 413 }) };
    }
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maximumBytes) {
    return { ok: false, response: Response.json({ error: "Request body is too large" }, { status: 413 }) };
  }
  try {
    return { ok: true, rawBody, value: JSON.parse(rawBody) as unknown };
  } catch {
    return { ok: false, response: Response.json({ error: "Request body must be valid JSON" }, { status: 400 }) };
  }
}
