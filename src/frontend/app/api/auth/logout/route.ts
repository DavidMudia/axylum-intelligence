import { authorizeOperator, logoutOperator } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = authorizeOperator(request, true);
  if (unauthorized) return unauthorized;
  return logoutOperator();
}
