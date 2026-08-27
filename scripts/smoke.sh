#!/usr/bin/env bash
# Smoke-test a deployed quartz.
#
#   ./scripts/smoke.sh                                  # seaof.glass/yt
#   ./scripts/smoke.sh quartz.example.workers.dev/yt    # anywhere else
#
# Pass the host plus base path, no scheme and no trailing slash.
# Exits non-zero if anything fails.

set -u

TARGET="${1:-seaof.glass/yt}"
BASE="https://$TARGET"
BOT="Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"
VID="dQw4w9WgXcQ"
PASS=0
FAIL=0
CB="$(date +%s)"

check() { # check <label> <expected-substring> <actual>
	if printf '%s' "$3" | grep -qF -- "$2"; then
		printf '  ok    %s\n' "$1"
		PASS=$((PASS + 1))
	else
		printf '  FAIL  %s\n' "$1"
		printf '        wanted: %s\n' "$2"
		printf '        got:    %s\n' "$(printf '%s' "$3" | head -c 200)"
		FAIL=$((FAIL + 1))
	fi
}

bot()   { curl -sS -A "$BOT" "$BASE$1"; }
human() { curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE$1"; }
code()  { curl -sS -o /dev/null -w '%{http_code}' "$BASE$1"; }

printf 'smoke test: %s\n\n' "$BASE"

printf 'link shapes\n'
check 'bare id'          "302 https://www.youtube.com/watch?v=$VID" "$(human "/$VID")"
check 'youtu.be'         "302 https://www.youtube.com/watch?v=$VID" "$(human "/youtu.be/$VID")"
check 'full watch url'   "v=$VID"    "$(human "/https://www.youtube.com/watch?v=$VID")"
check 'shorts'           "v=$VID"    "$(human "/youtube.com/shorts/$VID")"
check 'embed path'       "v=$VID"    "$(human "/youtube.com/embed/$VID")"
check 'timestamp kept'   't=30'      "$(human "/youtu.be/$VID?t=30")"
check 'playlist kept'    'list=PL'   "$(human "/watch?v=$VID&list=PLtest")"

printf '\nembeds\n'
check 'title'            'og:title" content="Rick Astley'          "$(bot "/$VID?cb=$CB")"
check 'channel'          'og:description" content="Rick Astley"'   "$(bot "/$VID?cb=$CB")"
check 'thumbnail'        'og:image" content="https://i.ytimg.com'  "$(bot "/$VID?cb=$CB")"
check 'image card'        'twitter:card" content="summary_large_image"' "$(bot "/$VID?cb=$CB")"
check 'direct .mp4 plays'  'video/mp4'  "$(curl -sS -o /dev/null -D - -r 0-1023 "$BASE/$VID.mp4")"
check 'direct .mp4 ranges' '206'        "$(curl -sS -o /dev/null -w '%{http_code}' -r 0-1023 "$BASE/$VID.mp4")"
check 'unavailable video' 'Video unavailable'                      "$(bot "/aaaaaaaaaaa?cb=$CB")"

printf '\nrouting\n'
check 'landing page'     'quartz'                    "$(curl -sS "$BASE/")"
check 'landing links repo' 'github.com/Lasimeri/quartz' "$(curl -sS "$BASE/")"
check 'garbage 404s'     '404'                       "$(code '/not-a-link')"
check 'oembed is rich'   '"type":"rich"'             "$(curl -sS "$BASE/oembed?a=test&u=https%3A%2F%2Fwww.youtube.com%2F%40RickAstleyYT")"
check 'oembed url pinned' '"author_url":"https://www.youtube.com"' "$(curl -sS "$BASE/oembed?u=https%3A%2F%2Fevil.example%2F")"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
