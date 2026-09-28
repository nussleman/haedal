#!/usr/bin/env python3
"""
해달 — 토스증권 수집기

  토스 Open API  →  (이 스크립트, 맥북)  →  Supabase toss_ingest()  →  해달

맥북에서 도는 이유:
  토스 API는 등록된 IP에서만 호출할 수 있다. 그래서 IP가 등록된 맥북이 조회하고,
  Supabase 에는 결과만 보낸다. (2026-09-28 구글 시트 → Supabase 로 바뀜)

Supabase 에는 toss_summary(요약) · toss_holdings(보유종목) · toss_daily(날짜별) 가 채워진다.
보내는 권한은 같은 폴더의 .ingest_key 한 줄(수집기 전용 비밀값). DB 에는 이 값의 해시만 있다.

의존성 없음. macOS 기본 python3 로 동작한다.

사용법
  확인만       python3 toss_collector.py --dry-run
  전송         python3 toss_collector.py
  자동 실행용  python3 toss_collector.py --quiet
"""

import argparse
import datetime as dt
import gzip
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://openapi.tossinvest.com"
ACCOUNT = os.environ.get("TOSS_ACCOUNT_SEQ", "1")
TIMEOUT = 60

CLIENT_ID     = os.environ.get("TOSS_ID", "")
CLIENT_SECRET = os.environ.get("TOSS_SECRET", "")
SB_URL  = "https://rjxmrpifrhybucexuvli.supabase.co"
SB_ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqeG1ycGlmcmh5YnVjZXh1dmxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NjU1OTAsImV4cCI6MjEwMTE0MTU5MH0"
           ".xSzE02pjZYqbx9nPLb8RVsQF9w7hJHEx2cO0JDOLLSU")   # 공개용 anon 키 (웹사이트에도 들어 있음)
KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".ingest_key")


def ingest_key():
    k = os.environ.get("HAEDAL_INGEST_KEY", "").strip()
    if not k and os.path.exists(KEY_FILE):
        with open(KEY_FILE) as fh:
            k = fh.read().strip()
    return k

QUIET = False


def say(*a):
    if not QUIET:
        print(*a)


def die(msg):
    sys.stderr.write("[%s] ERROR %s\n" % (stamp(), msg))
    sys.exit(1)


def stamp():
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M")


# ─────────────────── HTTP ───────────────────

def http(url, data=None, headers=None, timeout=None):
    """gzip 응답까지 처리하는 최소 HTTP 클라이언트."""
    h = dict(headers or {})
    h.setdefault("Accept", "application/json")
    h.setdefault("Accept-Encoding", "gzip")
    h.setdefault("User-Agent", "haedal-toss/1.0")
    req = urllib.request.Request(url, data=data, headers=h)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout or TIMEOUT, context=ctx) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return r.status, raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raw = e.read()
        if e.headers.get("Content-Encoding") == "gzip":
            try:
                raw = gzip.decompress(raw)
            except Exception:
                pass
        return e.code, raw.decode("utf-8", "replace")


def get_token():
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }).encode()
    st, tx = http(BASE + "/oauth2/token", data=body,
                  headers={"Content-Type": "application/x-www-form-urlencoded"})
    if st != 200:
        hint = ""
        if "IP address not allowed" in tx:
            hint = ("\n  → 지금 IP가 토스에 등록되지 않았습니다."
                    "\n     현재 IP 확인: curl -s https://api.ipify.org"
                    "\n     tossinvest.com → Open API 설정 → 허용 IP 에 추가하세요.")
        die("토큰 발급 실패 (HTTP %d) %s%s" % (st, tx[:200], hint))
    tok = json.loads(tx).get("access_token")
    if not tok:
        die("응답에 access_token 없음: " + tx[:200])
    return tok


def api(token, path, account=False):
    h = {"Authorization": "Bearer " + token}
    if account:
        h["X-Tossinvest-Account"] = ACCOUNT
    st, tx = http(BASE + path, headers=h)
    if st != 200:
        die("%s 실패 (HTTP %d) %s" % (path, st, tx[:200]))
    return json.loads(tx)["result"]


# ─────────────────── 계산 ───────────────────

def f(v):
    """토스는 모든 숫자를 문자열로 보낸다. None 도 온다."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def collect(token):
    holdings_raw = api(token, "/api/v1/holdings", account=True)
    fx = f(api(token, "/api/v1/exchange-rate"
               "?baseCurrency=USD&quoteCurrency=KRW")["rate"])
    if not (500 < fx < 5000):
        die("환율이 이상합니다: %s" % fx)

    cash = 0.0
    for cur in ("KRW", "USD"):
        r = api(token, "/api/v1/buying-power?currency=" + cur, account=True)
        amt = f(r.get("cashBuyingPower"))
        cash += amt * (fx if cur == "USD" else 1.0)

    mv = holdings_raw["marketValue"]["amount"]
    tp = holdings_raw["totalPurchaseAmount"]
    dp = holdings_raw["dailyProfitLoss"]["amount"]

    # krw / usd 는 서로 다른 통화 자산이다. 같은 값의 두 표기가 아니다.
    value = f(mv["krw"]) + f(mv["usd"]) * fx
    cost  = f(tp["krw"]) + f(tp["usd"]) * fx
    daily = f(dp["krw"]) + f(dp["usd"]) * fx
    pl = value - cost

    items = []
    for i in holdings_raw["items"]:
        rate = fx if i["currency"] == "USD" else 1.0
        v = f(i["marketValue"]["amount"]) * rate
        c = f(i["marketValue"]["purchaseAmount"]) * rate
        items.append({
            "name": i["name"],
            "symbol": i["symbol"],
            "country": i["marketCountry"],
            "currency": i["currency"],
            "qty": f(i["quantity"]),
            "avg": f(i["averagePurchasePrice"]),
            "last": f(i["lastPrice"]),
            "valueKrw": round(v),
            "costKrw": round(c),
            "plKrw": round(v - c),
            "plRate": f(i["profitLoss"]["rate"]),
        })

    summary = {
        "asOf": stamp(),
        "value": round(value),
        "cost": round(cost),
        "pl": round(pl),
        "plRate": pl / cost if cost else 0.0,
        "cash": round(cash),
        "total": round(value + cash),
        "fx": fx,
        "count": len(items),
        "daily": round(daily),
    }
    return summary, items


def send(summary, items):
    key = ingest_key()
    if not key:
        die("수집기 비밀값이 없습니다: %s" % KEY_FILE)
    body = json.dumps({"p_secret": key,
                       "p_summary": summary,
                       "p_holdings": items}, ensure_ascii=False).encode()
    st, tx = http(SB_URL + "/rest/v1/rpc/toss_ingest", data=body,
                  headers={"Content-Type": "application/json",
                           "apikey": SB_ANON,
                           "Authorization": "Bearer " + SB_ANON})
    return st, tx


# ─────────────────── main ───────────────────

def main():
    global QUIET
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="DB 에 쓰지 않고 결과만 출력")
    ap.add_argument("--quiet", action="store_true", help="자동 실행용. 한 줄만 출력")
    args = ap.parse_args()
    QUIET = args.quiet

    if not CLIENT_ID or not CLIENT_SECRET:
        die("TOSS_ID / TOSS_SECRET 환경변수가 비어 있습니다.")

    token = get_token()
    s, items = collect(token)

    say("  기준시각  %s" % s["asOf"])
    say("  환율      {:,.2f}".format(s["fx"]))
    say("  종목수    {}".format(s["count"]))
    say("  주식평가  {:,}원".format(s["value"]))
    say("  주식매입  {:,}원".format(s["cost"]))
    say("  평가손익  {:+,}원 ({:+.2f}%)".format(s["pl"], s["plRate"] * 100))
    say("  당일손익  {:+,}원".format(s["daily"]))
    say("  예수금    {:,}원".format(s["cash"]))
    say("  계좌총액  {:,}원".format(s["total"]))
    say("")
    say("  상위 5 종목")
    for h in sorted(items, key=lambda x: -x["valueKrw"])[:5]:
        say("    {:<20}{:>12,}원 ({:+.1f}%)".format(
            h["name"][:18], h["valueKrw"], h["plRate"] * 100))

    if args.dry_run:
        say("\n(--dry-run: DB 에는 쓰지 않았습니다)")
        return

    st, tx = send(s, items)
    ok = (st == 200 and '"ok":true' in tx.replace(" ", ""))

    if QUIET:
        print("[{}] {} {:,}원 / {}종목 / HTTP {}".format(
            s["asOf"], "OK" if ok else "FAIL", s["total"], s["count"], st))
    else:
        say("\n▶ DB 응답 (HTTP {}): {}".format(st, tx[:300]))

    if not ok:
        die("DB 기록 실패: " + tx[:300])
    say("완료")


if __name__ == "__main__":
    main()
