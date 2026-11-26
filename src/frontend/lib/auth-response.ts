export type AuthApiResponse = {
  authenticated?: boolean;
  user?: { email: string; role: string };
  signupAvailable?: boolean;
  bootstrapRequired?: boolean;
  bootstrapConfigured?: boolean;
  bootstrapAvailable?: boolean;
  operatorLoginAvailable?: boolean;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "boolean";
}

function isAuthApiResponse(value: unknown): value is AuthApiResponse {
  if (!isRecord(value)) return false;
  if (!isOptionalBoolean(value, "authenticated")) return false;
  if (!isOptionalBoolean(value, "signupAvailable")) return false;
  if (!isOptionalBoolean(value, "bootstrapRequired")) return false;
  if (!isOptionalBoolean(value, "bootstrapConfigured")) return false;
  if (!isOptionalBoolean(value, "bootstrapAvailable")) return false;
  if (!isOptionalBoolean(value, "operatorLoginAvailable")) return false;
  if (value.error !== undefined && typeof value.error !== "string") return false;
  if (value.user !== undefined) {
    if (!isRecord(value.user) || typeof value.user.email !== "string" || typeof value.user.role !== "string") return false;
  }
  return true;
}

export async function readAuthResponse(response: Response): Promise<AuthApiResponse> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(`Authentication service returned an empty response (HTTP ${response.status}).`);
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error(`Authentication service returned an invalid response (HTTP ${response.status}).`);
  }
  if (!isAuthApiResponse(value)) {
    throw new Error(`Authentication service returned an unexpected response (HTTP ${response.status}).`);
  }
  return value;
}
