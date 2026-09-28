#!/bin/bash
# 해달 — 토스증권 수집기 자동 실행 설치 스크립트
#
# 하는 일:
#   1) ~/haedal 폴더 만들기
#   2) 지금 터미널의 환경변수를 읽어 launchd 설정 파일 생성
#   3) 15분마다 자동 실행 등록
#
# 실행 전에 아래 2개가 지금 터미널에 설정돼 있어야 합니다:
#   TOSS_ID  TOSS_SECRET
# 그리고 같은 폴더에 .ingest_key (Supabase 로 보내는 수집기 전용 비밀값) 가 있어야 합니다.

set -e

DIR="$HOME/haedal"
PLIST="$HOME/Library/LaunchAgents/com.haedal.toss.plist"

echo "▶ 환경변수 확인"
MISSING=""
for V in TOSS_ID TOSS_SECRET; do
  if [ -z "${!V}" ]; then MISSING="$MISSING $V"; fi
done
if [ -n "$MISSING" ]; then
  echo "❌ 비어 있는 값:$MISSING"
  echo "   export 로 설정한 뒤 다시 실행하세요."
  exit 1
fi
echo "  OK"

echo "▶ 폴더 준비: $DIR"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"

if [ ! -f "$DIR/.ingest_key" ]; then
  echo "❌ $DIR/.ingest_key 가 없습니다. (Supabase 수집기 비밀값)"
  exit 1
fi

if [ ! -f "$DIR/toss_collector.py" ]; then
  echo "❌ $DIR/toss_collector.py 가 없습니다."
  echo "   toss_collector.py 를 $DIR 로 먼저 옮기세요."
  exit 1
fi

echo "▶ 수동 실행 테스트"
python3 "$DIR/toss_collector.py" --dry-run > /dev/null
echo "  OK"

echo "▶ launchd 설정 파일 생성"
# launchd 는 ~/.zshrc 를 읽지 않으므로 환경변수를 plist 에 직접 넣는다.
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.haedal.toss</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DIR/toss_collector.py</string>
    <string>--quiet</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOSS_ID</key><string>$TOSS_ID</string>
    <key>TOSS_SECRET</key><string>$TOSS_SECRET</string>
  </dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/toss.log</string>
  <key>StandardErrorPath</key><string>$DIR/toss.error.log</string>
</dict>
</plist>
PLISTEOF
chmod 600 "$PLIST"

echo "▶ 기존 등록 해제 (있으면)"
launchctl bootout "gui/$(id -u)/com.haedal.toss" 2>/dev/null || true

echo "▶ 자동 실행 등록"
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo ""
echo "✅ 완료 — 15분마다 자동 실행됩니다."
echo ""
echo "   로그 보기:  tail -f $DIR/toss.log"
echo "   에러 보기:  cat $DIR/toss.error.log"
echo "   지금 실행:  launchctl kickstart -k gui/\$(id -u)/com.haedal.toss"
echo "   해제:       launchctl bootout gui/\$(id -u)/com.haedal.toss"
