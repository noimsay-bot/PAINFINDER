import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/pipeline";

type SeedRow = { id: number; query_text: string; origin: string; last_used_at: string | null };

export async function GET(request: Request) {
  try {
    const requested = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const limit = Math.min(500, Math.max(1, Number.isFinite(requested) ? requested : 20));
    const rows = await supabaseRest(`seed_queries?active=eq.true&select=id,query_text,origin,last_used_at&order=last_used_at.asc.nullsfirst,id.asc&limit=${limit}`) as SeedRow[] | null;
    return NextResponse.json({ seeds: rows ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "시드를 불러오지 못했습니다." }, { status: 500 });
  }
}
