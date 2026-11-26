import { operatorSessionResponse } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return operatorSessionResponse(request);
}
