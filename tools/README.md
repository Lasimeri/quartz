# tools

Development aids. Not deployed, not part of the worker bundle.

| Tool | Purpose |
|---|---|
| `fmt.c` | Pull one format's fields out of an InnerTube player response |
| `boxes.c` | Print the box tree of an ISO-BMFF file |
| `muxtest.js` | Build a two-track file from live fragments, end to end |

The C tools build with tcc and have no dependencies:

```sh
tcc -o fmt fmt.c
tcc -o boxes boxes.c
```

## Verifying the muxer

`muxtest.js` needs a player response on disk and the compiled `fmt`:

```sh
curl -s -X POST https://www.youtube.com/youtubei/v1/player \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip' \
  -d '{"context":{"client":{"clientName":"ANDROID_VR","clientVersion":"1.60.19","deviceMake":"Oculus","deviceModel":"Quest 3","androidSdkVersion":32,"osName":"Android","osVersion":"12","hl":"en"}},"videoId":"<id>","contentCheckOk":true,"racyCheckOk":true}' \
  -o pr.json

npx tsc -p ../tsconfig.test.json     # compile src/mp4 to plain JS
node muxtest.js                       # writes muxed.mp4
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height muxed.mp4
```

A correct run reports two streams, h264 and aac, and both decode:

```sh
ffmpeg -v error -i muxed.mp4 -map 0:v -f null -
ffmpeg -v error -i muxed.mp4 -map 0:a -f null -
```
