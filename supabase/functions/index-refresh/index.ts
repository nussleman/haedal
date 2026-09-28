// index-refresh — S&P500 월말 종가를 index_prices 에 채운다.
// 대시보드가 로딩할 때 지난달 값이 비어 있으면 호출한다 (로그인한 사용자만).
// 이미 있는 달은 덮어쓰지 않는다. 진행 중인 달은 넣지 않는다.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Row = { symbol: string; month: string; close: number; source: string };

function kstMonthStart(): string {
  const now = new Date(Date.now() + 9 * 3600e3);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function fromYahoo(): Promise<Row[]> {
  const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5y&interval=1mo", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts: number[] = res?.timestamp || [];
  const cl: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
  const out: Row[] = [];
  ts.forEach((t, i) => {
    const c = cl[i];
    if (c == null) return;
    const d = new Date((t + 12 * 3600) * 1000); // 월 시작 타임스탬프 → 해당 월
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    out.push({ symbol: "SPX", month, close: Math.round(c * 100) / 100, source: "yahoo" });
  });
  return out;
}

async function fromStooq(): Promise<Row[]> {
  const r = await fetch("https://stooq.com/q/d/l/?s=%5Espx&i=m");
  if (!r.ok) throw new Error(`stooq ${r.status}`);
  const lines = (await r.text()).trim().split("\n").slice(1);
  return lines.map((ln) => ln.split(",")).filter((c) => c.length >= 5 && c[4]).map((c) => ({
    symbol: "SPX", month: c[0].slice(0, 7) + "-01", close: Number(c[4]), source: "stooq",
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 로그인한 사용자만 (anon 키만으로는 호출 불가)
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: cors });

  let rows: Row[] = [];
  let used = "";
  for (const [name, fn] of [["yahoo", fromYahoo], ["stooq", fromStooq]] as const) {
    try { rows = await fn(); used = name; if (rows.length) break; } catch (_) { /* 다음 소스 */ }
  }
  const cur = kstMonthStart();
  rows = rows.filter((r) => r.month < cur && isFinite(r.close) && r.close > 0);
  if (!rows.length) return new Response(JSON.stringify({ error: "no data", used }), { status: 502, headers: cors });

  const { error, count } = await admin.from("index_prices")
    .upsert(rows, { onConflict: "symbol,month", ignoreDuplicates: true, count: "exact" });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
  return new Response(JSON.stringify({ ok: true, used, candidates: rows.length, inserted: count }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
