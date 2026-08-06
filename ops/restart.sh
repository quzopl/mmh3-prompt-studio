#!/usr/bin/env bash
# Podnosi MMH3 Prompt Studio: API na 8899, interfejs na 9921, oba na 0.0.0.0.
#
# Zatrzymywanie po WŁAŚCICIELU PORTU, nie po wzorcu w wierszu poleceń: `pkill -f`
# zabijał w tym projekcie własną powłokę ssh, bo jej wiersz poleceń zawierał
# szukany wzorzec. `ss` mówi, kto naprawdę trzyma port.
#
# Serwer NIE MA kroku budowania — startuje wprost z TypeScriptu przez `tsx`
# (`server/package.json`, skrypt `start`). Buduje się tylko interfejs.
set -uo pipefail
cd "$HOME/mmh3-studio"

kill_port() {
  local port="$1" pid
  pid=$(ss -ltnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1)
  if [ -n "${pid:-}" ]; then
    kill "$pid" 2>/dev/null && echo "zatrzymano $port (pid $pid)"
    sleep 1
  fi
}

# Model NAJPIERW, i to przez API — dopiero potem samo API. Zabicie API bez
# tego kroku zostawia `llama-server` z PPID 1, trzymający cały model w pamięci
# karty: init przygarnia sierotę, a nowe API nie ma do niej uchwytu, więc
# przycisk „Zwolnij pamięć karty" nie ma czego zatrzymać. Zmierzone
# 2026-08-06: dwa takie procesy po 9,9 GB po dwóch wdrożeniach.
#
# Sam kod serwera też się przed tym broni (`installShutdownHooks` reaguje na
# SIGTERM), ale ten krok działa TAKŻE wtedy, gdy API zostało ubite twardo albo
# padło wcześniej — a wtedy żaden hak już nie zadziała.
curl -s -m 20 -X POST http://127.0.0.1:8899/api/llm/managed/stop >/dev/null 2>&1 \
  && echo "zatrzymano model przez API"

kill_port 8899
kill_port 9921

# Sierota z WCZEŚNIEJSZYCH wdrożeń, sprzed tej poprawki: proces llama-server bez
# żywego rodzica (PPID 1). Nie dotykamy modeli uruchomionych przez kogoś innego
# — tylko te, których rodzic już nie istnieje.
for pid in $(pgrep -f '[l]lama-server' 2>/dev/null); do
  if [ "$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')" = "1" ]; then
    kill "$pid" 2>/dev/null && echo "zatrzymano osierocony model (pid $pid)"
  fi
done

git fetch --quiet origin && git reset --quiet --hard origin/master
npm install --no-audit --no-fund >/dev/null 2>&1

# Build interfejsu bez połykania błędu: cichy build, który się nie udał, to
# dokładnie ten sposób, w jaki poprzednia wersja tego skryptu udawała sukces.
if ! npm run build --workspace @mmh3/web > "$HOME/mmh3-run/build.log" 2>&1; then
  echo "BUILD INTERFEJSU PADL — patrz ~/mmh3-run/build.log"
  tail -15 "$HOME/mmh3-run/build.log"
  exit 1
fi
echo "interfejs zbudowany"

mkdir -p "$HOME/mmh3-run"
# 0.0.0.0 i bez uwierzytelniania — świadoma decyzja właściciela maszyny.
MMH3_HOST=0.0.0.0 MMH3_PORT=8899 \
  nohup npm run start --workspace @mmh3/server > "$HOME/mmh3-run/api.log" 2>&1 &
echo "API 8899 pid $!"

cd "$HOME/mmh3-studio/web"
nohup npx vite preview --host 0.0.0.0 --port 9921 --strictPort \
  > "$HOME/mmh3-run/web.log" 2>&1 &
echo "UI 9921 pid $!"

sleep 6
ss -ltn | grep -E ":(8899|9921) " || echo "UWAGA: porty nie nasluchuja"
