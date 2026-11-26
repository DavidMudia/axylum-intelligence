import { getPaperPortfolio } from "@backend/intelligence/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getPaperPortfolio());
}

export async function POST(_request: Request) {
  return Response.json({ error: "Manual order placement is disabled; only approved autonomous paper decisions can execute." }, { status: 403 });
}
