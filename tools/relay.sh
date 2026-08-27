#!/usr/bin/env bash
#
# relay - download a video, mux or encode it, and hand it to the worker.
#
#   ./tools/relay.sh <id-or-url> [options]
#
# Runs on a trusted machine rather than in the worker, which is the
# whole point: YouTube serves a home address normally while refusing
# Cloudflare's edge ranges for some videos. Anything relayed this way
# plays regardless of what the worker can reach on its own.
#
# Modes
#   (default)     stream copy H.264 + AAC into MP4. No re-encode, no
#                 quality loss, plays everywhere.
#   --av1         encode AV1 + Opus. Smallest, and the least widely
#                 decodable: no iPhone before A17 Pro, and many Android
#                 devices lack it. An unsupported codec gives a broken
#                 player, not a fallback.
#   --nvenc       transcode H.264 on the GPU. Fast, moderate savings.
#   --hevc        transcode HEVC on the GPU.
#
# Options
#   --vb RATE     video bitrate for --av1 (default 1500k)
#   --ab RATE     audio bitrate for --av1 (default 96k)
#   --preset N    SVT-AV1 preset 0-13, lower is slower and better
#                 (default 4)
#   --cq N        quality for NVENC modes (default 26)
#   --height N    cap resolution (default 720)
#   --gpu N       GPU index for NVENC (default 0, the 3090 non-Ti)
#   --keep        leave the built file in the current directory
#   --no-upload   build and stop
#
# Environment
#   QUARTZ_ENDPOINT  default https://seaof.glass/yt
#   QUARTZ_TOKEN     bearer token matching the worker's RELAY_TOKEN
#
# Hardware note: Ampere cards (3090, 3090 Ti) have AV1 decode but no
# AV1 encode silicon, so --av1 runs SVT-AV1 on the CPU and is slow.
# --nvenc and --hevc use the GPU and are fast.

set -euo pipefail

ENDPOINT="${QUARTZ_ENDPOINT:-https://seaof.glass/yt}"
TOKEN="${QUARTZ_TOKEN:-}"
HEIGHT=720
VB=1500k
AB=96k
PRESET=4
CQ=26
GPU=0
MODE=copy
KEEP=0
UPLOAD=1

ARG=""
while [ $# -gt 0 ]; do
	case "$1" in
		--av1)       MODE=av1 ;;
		--nvenc)     MODE=nvenc ;;
		--hevc)      MODE=hevc ;;
		--vb)        VB="$2"; shift ;;
		--ab)        AB="$2"; shift ;;
		--preset)    PRESET="$2"; shift ;;
		--cq)        CQ="$2"; shift ;;
		--height)    HEIGHT="$2"; shift ;;
		--gpu)       GPU="$2"; shift ;;
		--keep)      KEEP=1 ;;
		--no-upload) UPLOAD=0 ;;
		-h|--help)   sed -n '3,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		-*)          echo "unknown option: $1" >&2; exit 2 ;;
		*)           ARG="$1" ;;
	esac
	shift
done

[ -n "$ARG" ] || { echo "usage: relay.sh <id-or-url> [options]" >&2; exit 2; }

if printf '%s' "$ARG" | grep -qE '^[A-Za-z0-9_-]{11}$'; then
	ID="$ARG"
else
	ID=$(printf '%s' "$ARG" | grep -oE '[A-Za-z0-9_-]{11}' | head -1) || true
fi
[ -n "${ID:-}" ] || { echo "no video id found in: $ARG" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/$ID.mp4"

# Pull the highest-quality source available; re-encoding from a better
# source is worth more than matching the target codec on download.
if [ "$MODE" = av1 ]; then
	FMT="bestvideo[height<=$HEIGHT]+bestaudio/best[height<=$HEIGHT]"
else
	FMT="bestvideo[height<=$HEIGHT][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=$HEIGHT]"
fi

echo "==> fetching $ID (height<=$HEIGHT)"
yt-dlp -f "$FMT" --no-playlist -o "$WORK/src.%(ext)s" --quiet --no-warnings \
	"https://www.youtube.com/watch?v=$ID"

SRC=$(find "$WORK" -maxdepth 1 -name 'src.*' | head -1)
[ -n "$SRC" ] || { echo "download produced nothing" >&2; exit 1; }

# SVT-AV1 tuning, all verified against v4.1.0.
#
#   tune=0             optimise for how it looks, not for PSNR
#   film-grain=8       synthesise grain at decode instead of spending
#                      bits coding it, which is where a low bitrate
#                      otherwise goes to die
#   film-grain-denoise=0  keep the source's own detail
#   enable-overlays=1  overlay frames, better quality at scene joins
#   enable-tf=1        temporal filtering for alt-ref frames
#   enable-qm=1        quantisation matrices, distribute error by
#   qm-min=0           frequency rather than flatly
#   scd=1              detect cuts and place keyframes at them
#
# 10-bit is used even though the source is 8-bit: the wider internal
# precision suppresses banding in gradients, which is the artefact a
# 1500k target produces first.
AV1_PARAMS="tune=0:film-grain=8:film-grain-denoise=0:enable-overlays=1:enable-tf=1:enable-qm=1:qm-min=0:scd=1:keyint=240"

# Opus at 96k.
#
#   compression_level 10  maximum analysis effort
#   frame_duration 60     longest frames, lowest per-packet overhead,
#                         which is where efficiency comes from at low
#                         bitrates
#   vbr on                true VBR, spend bits where they matter
#   application audio     music tuning rather than speech
#   cutoff 20000          full band, no early lowpass
#
# Deliberately no packet-loss FEC: it buys resilience on a lossy
# transport by spending bits on redundancy, which in a stored file only
# lowers quality at a fixed bitrate.
OPUS_ARGS=(-c:a libopus -b:a "$AB" -vbr on -compression_level 10 -frame_duration 60 -application audio -cutoff 20000)

case "$MODE" in
	copy)
		echo "==> muxing (stream copy, faststart)"
		ffmpeg -v error -y -i "$SRC" -c copy -movflags +faststart "$OUT"
		;;
	av1)
		echo "==> encoding AV1 ${VB} + Opus ${AB}, preset $PRESET, two-pass"
		echo "    pass 1"
		ffmpeg -v error -y -i "$SRC" -c:v libsvtav1 -b:v "$VB" -preset "$PRESET" \
			-pix_fmt yuv420p10le -svtav1-params "$AV1_PARAMS" \
			-pass 1 -passlogfile "$WORK/pl" -an -f null - 
		echo "    pass 2"
		ffmpeg -v error -y -i "$SRC" -c:v libsvtav1 -b:v "$VB" -preset "$PRESET" \
			-pix_fmt yuv420p10le -svtav1-params "$AV1_PARAMS" \
			-pass 2 -passlogfile "$WORK/pl" \
			"${OPUS_ARGS[@]}" -movflags +faststart "$OUT"
		;;
	nvenc)
		echo "==> transcoding H.264 on GPU $GPU"
		ffmpeg -v error -y -hwaccel cuda -hwaccel_device "$GPU" -i "$SRC" \
			-c:v h264_nvenc -gpu "$GPU" -preset p5 -rc vbr -cq "$CQ" \
			-c:a aac -b:a 128k -movflags +faststart "$OUT"
		;;
	hevc)
		echo "==> transcoding HEVC on GPU $GPU"
		ffmpeg -v error -y -hwaccel cuda -hwaccel_device "$GPU" -i "$SRC" \
			-c:v hevc_nvenc -gpu "$GPU" -preset p5 -rc vbr -cq "$CQ" \
			-tag:v hvc1 -c:a aac -b:a 128k -movflags +faststart "$OUT"
		;;
esac

SIZE=$(stat -c %s "$OUT")
printf '==> built %s: %d MB\n' "$(basename "$OUT")" "$((SIZE / 1024 / 1024))"
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height -of csv=p=0 "$OUT" | sed 's/^/    /'

if [ "$UPLOAD" -eq 1 ]; then
	[ -n "$TOKEN" ] || { echo "QUARTZ_TOKEN is not set" >&2; exit 1; }
	echo "==> uploading to $ENDPOINT/store/$ID"
	curl -fsS -X PUT "$ENDPOINT/store/$ID" \
		-H "Authorization: Bearer $TOKEN" \
		-H "Content-Type: video/mp4" \
		--data-binary "@$OUT" --max-time 3600
	echo
	echo "==> live at $ENDPOINT/$ID.mp4"
fi

[ "$KEEP" -eq 1 ] && { cp "$OUT" "./$(basename "$OUT")"; echo "==> kept ./$(basename "$OUT")"; }
exit 0
