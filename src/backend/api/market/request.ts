const DEFAULT_SYMBOL = "BTCUSDT";

export function marketSymbol(params: URLSearchParams): string | Response {
  const configured = (process.env.MARKET_SYMBOL ?? DEFAULT_SYMBOL).trim().toUpperCase();
  const requested = params.get("symbol")?.trim().toUpperCase();
  if (requested && requested !== configured) {
    return Response.json({ error: `Only ${configured} is currently enabled` }, { status: 400 });
  }
  return configured;
}

export function boundedInteger(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number | Response {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return Response.json({ error: `${name} must be an integer between ${min} and ${max}` }, { status: 400 });
  }
  return value;
}

export function isResponse(value: number | string | Response): value is Response {
  return value instanceof Response;
}
