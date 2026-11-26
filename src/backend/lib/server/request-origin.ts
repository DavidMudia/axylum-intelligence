const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const production = process.env.NODE_ENV === "production";
  if (!origin) return !production;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const requestHost = forwardedHost?.split(",")[0].trim() ?? request.headers.get("host");
    const loopbackHttp = originUrl.protocol === "http:" && LOCAL_HTTP_HOSTS.has(originUrl.hostname.toLowerCase());
    return Boolean(
      requestHost &&
      originUrl.host.toLowerCase() === requestHost.toLowerCase() &&
      (!production || originUrl.protocol === "https:" || loopbackHttp),
    );
  } catch {
    return false;
  }
}
