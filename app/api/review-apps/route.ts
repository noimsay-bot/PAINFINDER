import { NextResponse } from "next/server";
import { searchReviewApps } from "@/lib/app-reviews";
import { supabaseRest } from "@/lib/pipeline";

type Row = Record<string, unknown>;

export const runtime = "nodejs";

function clean(value: unknown, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeName(value: unknown) {
  return clean(value, 160).toLocaleLowerCase("ko-KR").replace(/[^a-z0-9가-힣]/g, "");
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query")?.trim();
    if (query) return NextResponse.json(await searchReviewApps(query));

    const [apps, rawRows] = await Promise.all([
      supabaseRest("review_apps?select=id,name,ios_app_id,android_package,ios_url,android_url,active,created_at,updated_at&order=created_at.asc") as Promise<Row[] | null>,
      supabaseRest("raw_items?source=in.(appstore,playstore)&select=app_target_id,status,pain_points(decisions(action))&order=collected_at.desc&limit=10000") as Promise<Row[] | null>,
    ]);
    const appRows = (apps ?? []).map(app => {
      const relevant = (rawRows ?? []).filter(raw => String(raw.app_target_id ?? "") === String(app.id));
      const candidates = relevant.filter(raw => Array.isArray(raw.pain_points) ? raw.pain_points.length > 0 : Boolean(raw.pain_points));
      const tracked = candidates.filter(raw => {
        const pains = Array.isArray(raw.pain_points) ? raw.pain_points as Row[] : raw.pain_points ? [raw.pain_points as Row] : [];
        return pains.some(pain => (Array.isArray(pain.decisions) ? pain.decisions as Row[] : []).some(decision => decision.action === "tracking"));
      }).length;
      return {
        id: Number(app.id),
        name: String(app.name),
        iosId: app.ios_app_id ? String(app.ios_app_id) : null,
        androidPackage: app.android_package ? String(app.android_package) : null,
        iosUrl: app.ios_url ? String(app.ios_url) : null,
        androidUrl: app.android_url ? String(app.android_url) : null,
        active: Boolean(app.active),
        collected: relevant.length,
        candidates: candidates.length,
        tracked,
        trackingRate: candidates.length ? tracked / candidates.length : 0,
      };
    });
    return NextResponse.json({ apps: appRows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "대상 앱을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; id?: number; active?: boolean; platform?: "ios" | "android"; name?: string; appId?: string; url?: string };
    if (body.action === "toggle") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return NextResponse.json({ error: "앱 ID가 필요합니다." }, { status: 400 });
      await supabaseRest(`review_apps?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ active: Boolean(body.active), updated_at: new Date().toISOString() }) });
      return NextResponse.json({ ok: true });
    }

    if (body.action !== "add" || !["ios", "android"].includes(String(body.platform))) {
      return NextResponse.json({ error: "추가할 앱 플랫폼을 선택해 주세요." }, { status: 400 });
    }
    const name = clean(body.name, 160);
    const appId = clean(body.appId, 180);
    const url = clean(body.url, 500);
    if (!name || !appId) return NextResponse.json({ error: "앱 이름과 ID가 필요합니다." }, { status: 400 });

    const current = await supabaseRest("review_apps?select=id,name,ios_app_id,android_package,ios_url,android_url,active&limit=1000") as Row[] | null;
    const existing = (current ?? []).find(app =>
      (body.platform === "ios" && String(app.ios_app_id ?? "") === appId)
      || (body.platform === "android" && String(app.android_package ?? "") === appId)
      || normalizeName(app.name) === normalizeName(name)
    );
    const fields = body.platform === "ios"
      ? { ios_app_id: appId, ios_url: url || `https://apps.apple.com/kr/app/id${appId}` }
      : { android_package: appId, android_url: url || `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}` };
    const payload = { name: existing ? String(existing.name) : name, ...fields, active: true, updated_at: new Date().toISOString() };
    const saved = await supabaseRest(existing ? `review_apps?id=eq.${Number(existing.id)}` : "review_apps", {
      method: existing ? "PATCH" : "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    return NextResponse.json({ ok: true, saved: saved ?? payload });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "대상 앱을 저장하지 못했습니다." }, { status: 500 });
  }
}
