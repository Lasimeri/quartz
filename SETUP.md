# Setup

Everything needed to run your own copy, from nothing to a working route.

---

## Table of contents

1. [What you need](#1-what-you-need)
2. [Fast path: deploy in five minutes](#2-fast-path-deploy-in-five-minutes)
3. [Mounting it on your own domain](#3-mounting-it-on-your-own-domain)
4. [Verifying it works](#4-verifying-it-works)
5. [Customizing](#5-customizing)
6. [Pointing at a self-hosted frontend](#6-pointing-at-a-self-hosted-frontend)
7. [Media modes](#7-media-modes)
8. [Relaying from a trusted machine](#8-relaying-from-a-trusted-machine)
9. [Links without the /yt prefix](#9-links-without-the-yt-prefix)
10. [Troubleshooting](#10-troubleshooting)
11. [How it works](#11-how-it-works)
12. [Known limits](#12-known-limits)
13. [Maintenance](#13-maintenance)

---

## 1. What you need

| Requirement | Notes |
|---|---|
| Node.js 18 or newer | `node --version`. Only used to run wrangler locally. |
| A Cloudflare account | Free tier is enough. No credit card. |
| A domain (optional) | Only for section 3. |
| Git | To clone. |

You do **not** need a YouTube API key, a Google Cloud project, or a quota
allocation. Metadata comes from YouTube's public oEmbed endpoint, which is the
same one WordPress and every other site uses to embed a video.

**Cost:** zero. Only crawler hits and human redirects reach the worker, and the
free tier covers 100,000 requests per day.

---

## 2. Fast path: deploy in five minutes

```sh
git clone https://github.com/Lasimeri/quartz.git
cd quartz
npm install --legacy-peer-deps
```

> **Why `--legacy-peer-deps`:** wrangler 4 declares an optional peer dependency
> on `@cloudflare/workers-types` v5 with ranges npm reads as conflicting. The
> flag tells npm to proceed. `npm run check` passing confirms nothing is
> actually broken.

Edit `wrangler.toml`, change `name` to whatever you like, and delete the
`[[routes]]` block. Then:

```sh
npx wrangler login
npm run deploy
```

You get `https://<name>.<your-subdomain>.workers.dev`, and the worker lives
under `/yt` on it. Test:

```sh
npm run smoke -- <name>.<your-subdomain>.workers.dev/yt
```

---

## 3. Mounting it on your own domain

quartz mounts on a **path**, not a hostname, so the rest of your site keeps
being served by whatever already serves it. On seaof.glass that is GitHub
Pages: `seaof.glass/yt/*` goes to the worker, everything else does not.

### 3.1 The zone must be on Cloudflare

The domain needs to be an active zone in your Cloudflare account: add the site,
point your registrar's nameservers at the two Cloudflare gives you, wait for
*Active*.

### 3.2 Declare the route

```toml
[[routes]]
pattern = "your-domain.com/yt/*"
zone_name = "your-domain.com"
```

To mount somewhere other than `/yt`, change **both** the pattern and `BASE` in
`src/config.ts`. They must agree, or the worker will 404 everything.

```sh
npm run deploy
```

### 3.3 If the route fails to register

Path routes are written through the **zone** API, which needs a permission that
account-level tokens do not carry. A token without it deploys the script fine
and then fails only on the route:

```
Routes:
  - A request to the Cloudflare API (/zones/<id>/workers/routes) failed.
    - Authentication error [code: 10000]
```

Two fixes, either works:

- **Dashboard, no token changes.** Workers & Pages, open the worker, Settings,
  Domains & Routes, Add route. Pattern `your-domain.com/yt/*`, pick the zone.
- **Fix the token.** Where the token lives depends on its type, and this
  catches people out: a value beginning `cfat_` is an **account-owned**
  token, found under *Manage Account > API Tokens*. Anything else is a
  user token, found under *My Profile > API Tokens*. Edit it, add
  *Zone > Workers Routes > Edit*, and make sure Zone Resources includes
  the zone. The secret value does not change, so whatever stores it
  keeps working. Then `npm run deploy`.

An OAuth login (`npx wrangler login`) carries this permission, but note
that `CLOUDFLARE_API_TOKEN` takes precedence over it whenever the
variable is set, and wrangler will not refresh expired OAuth
credentials in a non-interactive shell. To force the OAuth path for one
command, unset the variable for that command only:

```sh
env -u CLOUDFLARE_API_TOKEN npx wrangler deploy
```

---

## 4. Verifying it works

```sh
npm run smoke                      # defaults to seaof.glass/yt
npm run smoke -- your-domain.com/yt
```

Seventeen checks: every accepted link shape, timestamp and playlist
passthrough, the embed card, the unavailable-video fallback, the landing page,
and that hostile input is refused.

By hand:

```sh
curl -sI https://your-domain.com/yt/dQw4w9WgXcQ | head -1
curl -s -A "Discordbot/2.0" https://your-domain.com/yt/dQw4w9WgXcQ
```

In Discord: post a link. **Use a video you have never posted through this
worker before**, or append `?cb=1`. Discord caches scraped embeds per URL for
hours, which is the single most common reason a fix appears not to have worked.

---

## 5. Customizing

Everything adjustable is in `src/config.ts`.

| Setting | Default | Effect |
|---|---|---|
| `WATCH_ORIGIN` | `https://www.youtube.com` | Where humans are sent |
| `BASE` | `/yt` | Path prefix; must match the route pattern |
| `THEME_COLOR` | `#c4945a` | Colour of the embed's left bar |
| `USE_PLAYER_CARD` | `true` | See below |
| `BOT_UA` | Discord, Telegram, Slack, ... | Which agents get meta tags |
| `RATE_LIMIT` | `60` | Requests per IP per minute |
| `CACHE_OK` | `3600` | Seconds to cache a successful card |
| `CACHE_MISSING` | `300` | Seconds to cache an unavailable video |

### About `USE_PLAYER_CARD`

On (the default) the page emits the same video tags youtube.com emits on its
own watch pages: `og:video` and `og:video:secure_url` pointing at
`youtube.com/embed/<id>`, `og:video:type` of `text/html`, dimensions, and a
`twitter:player` card. `og:image` is emitted either way, so a client that
declines the player still renders the thumbnail rather than losing the card.

**Whether you get a real player is decided by the chat client, not by these
tags.** Discord only runs iframe players for hosts on its own allowlist, and it
weighs the page's domain as well as the player's, so a third-party page
offering a YouTube player can still be refused. Mobile clients are stricter
than desktop, and the Discord Android app in particular has been observed
showing only the thumbnail.

There is no server-side fix for a refusal. Inline playback that does not depend
on an allowlist requires a direct media URL in `og:video`, which for YouTube
means solving the PO token and adaptive-format problems described in section 6.

Set it to `false` to go back to a plain large-image card.

---

## 6. Pointing at a self-hosted frontend

If you later run Invidious, Piped, or similar, change one constant:

```ts
export const WATCH_ORIGIN = 'https://yt.example.com';
```

Redeploy. Every link already shared keeps working and now lands on your
frontend. The embed card still comes from YouTube's oEmbed endpoint, which
keeps working regardless of what your frontend can or cannot fetch.

**Worth knowing before you plan that:** serving video yourself is much harder
than it looks. YouTube removed the 720p muxed format (itag 22) in June 2024, so
anything above 360p is adaptive video-only and must be paired with a separate
audio track. Stream URLs additionally require a PO token generated by running
YouTube's BotGuard, which needs a real DOM, which a Worker does not have. That
work belongs on a machine that can run a browser. quartz deliberately does not
attempt it, which is why it has nothing to break.

---

## 7. Media modes
### The two link forms

| Link | What Discord shows |
|---|---|
| `<host>/yt/<id>` | A card: title, channel, thumbnail |
| `<host>/yt/<id>.mp4` | A video that plays in the chat window |

A media link is the one video path that works from any domain. Chat clients
play a url ending in `.mp4` that answers with `Content-Type: video/mp4`, the
same way they play any other direct file link. No OpenGraph tags are involved,
so no allowlist applies.

That is worth stating plainly, because the obvious-looking alternative does not
work: putting the same mp4 in `og:video` on an HTML page gets refused, and a
refused video card yields **no embed at all**, not a fallback to the thumbnail.
The gate is the page's domain, not the file's playability. `MEDIA_MODE` stays
`off` for that reason.

The tradeoff is that a media link carries no metadata, so a player and a
titled card cannot come from one url. Post whichever suits the moment.


`MEDIA_MODE` in `src/config.ts` decides how the embed offers video.

| Mode | Playback | Needs |
|---|---|---|
| `off` | Thumbnail only | Nothing |
| `iframe` | Only where the client allowlists youtube.com | Nothing |
| `proxy` (default) | Real inline playback, 360p | Nothing |
| `external` | Real inline playback, any quality you mux | A backend |


### Why `MEDIA_MODE` defaults to `off`

A chat embed is not a browser. It runs no JavaScript, so a custom player
cannot execute inside it. Clients render a static image, their own native
player fed a direct media URL, or an iframe for an allowlisted host. That
leaves one route to playback that does not depend on someone's allowlist:
hand the native player a single progressive MP4.

YouTube's format 18 is exactly that, 360p H.264 with AAC already muxed into
one file. The worker fetches its URL and streams the bytes through, forwarding
Range so seeking works. No muxing, no storage, no backend.

The bytes do have to transit the worker: googlevideo binds a URL to the IP that
requested it, so handing the raw URL to a viewer earns a 403. The body is
streamed rather than buffered, so this costs bandwidth rather than CPU or
memory.

### Above 360p

360p is the ceiling for single-file playback because YouTube removed the 720p
muxed format in June 2024. Everything higher is adaptive: video-only, needing a
separate audio track and a container mux to become one playable file.

Muxing is possible in a Worker. Adaptive streams are fragmented MP4 already,
sample tables are small and sit at known offsets, R2 gives durable storage with
multipart upload, and the 128MB memory ceiling is avoidable by processing in
chunks and streaming out. It is a real MP4 muxer's worth of work, in
TypeScript, without ffmpeg, and it must be right about sample offsets or
nothing plays.

The cheaper route to the same result is `external`: a backend where `ffmpeg`
already solves this. `backend/server.mjs` is a working reference at about 150
lines. Set `MEDIA_ORIGIN` to its origin and `MEDIA_MODE` to `external`, and the
worker pre-warms it the moment a link is scraped, so muxing starts long before
anyone presses play.

### Reliability note

InnerTube rejects roughly one in ten requests arriving from Cloudflare's edge
ranges, and answers the rest normally. `fetchFormats` retries three times with
a growing pause, which took a measured 9-in-10 success rate to 10-in-10. If
that share ever climbs, this is the first thing to check.

### Risk

Proxying third-party video is a YouTube terms violation and puts your host in
the delivery path for other people's copyrighted material. `src/stream.ts`
depends on an undocumented endpoint that can change without notice. Run it
knowing both.


## 8. Relaying from a trusted machine

YouTube refuses some videos when the request comes from a Cloudflare edge
range, answering `LOGIN_REQUIRED` regardless of client. A home address is
served normally. `tools/relay.sh` exploits exactly that: it downloads and muxes
locally, then uploads the finished file to the worker, which stores it in R2
and serves it from there.

### Setup

```sh
npx wrangler secret put RELAY_TOKEN      # any long random string
export QUARTZ_TOKEN='<the same string>'
export QUARTZ_ENDPOINT=https://seaof.glass/yt
```

### Use

```sh
./tools/relay.sh dQw4w9WgXcQ                    # H.264 + AAC, stream copy
./tools/relay.sh <url> --av1                    # AV1 1500k + Opus 96k
./tools/relay.sh <url> --av1 --vb 2000k --ab 128k
./tools/relay.sh <url> --nvenc --cq 24          # H.264 on the GPU
./tools/relay.sh <url> --hevc                   # HEVC on the GPU
```

Once uploaded, `<endpoint>/<id>.mp4` serves from R2 and never touches YouTube.
Stored files answer with `X-Quartz-Source: r2`, and `DELETE <endpoint>/store/<id>`
removes one.


### Codecs, with numbers
### VP9

```sh
./tools/relay.sh <url> --vp9              # copy YouTube's VP9 + Opus
./tools/relay.sh <url> --vp9-encode --vb 1500k
```

`--vp9` is the one to use. YouTube already publishes VP9, so this is a stream
copy: instant, lossless, and about 21% smaller than the H.264 rendition. On the
video measured above, YouTube's own 720p VP9 runs about 785 kbps, already well
under a 1500k target, so re-encoding to hit that number would spend hours to
produce something larger and worse.

`--vp9-encode` exists for when a specific bitrate is the requirement rather
than the size. It is two-pass `libvpx-vp9` on the CPU, with `row-mt`, tile
columns, alt-ref frames and a 25-frame lookahead. Expect it to be slow.

**No GPU path exists for VP9.** NVENC has never encoded VP9 on any NVIDIA card;
`vp9_nvenc` is not a codec ffmpeg recognises. The 3090 decodes VP9 through
NVDEC but cannot encode it. The only VP9 encoders present are `libvpx-vp9`
(CPU), `vp9_vaapi` and `vp9_qsv`, and the latter two want Intel or AMD
hardware.

VP9 and AV1 both produce WebM, served at `<endpoint>/<id>.webm`. That path is
relay-only: the live mux produces H.264 and AAC in MP4, so an unrelayed WebM
request returns 404 rather than silently serving something else.


Measured on one 720p video, comparing what YouTube itself publishes:

| Stream | Size | vs baseline |
|---|---|---|
| H.264 720p | 26,588 KB | baseline |
| VP9 720p | 20,948 KB | 21% smaller |
| AAC audio | 1,554 KB | baseline |
| Opus audio | 1,503 KB | 3% smaller |

The savings are almost entirely in the video codec. Opus over AAC buys about
3% of a track that is itself 5% of the file.

The default is H.264 plus AAC because every client decodes it. AV1 is
materially smaller and materially less playable: no iPhone before the A17 Pro,
and many Android devices lack a decoder. An unsupported codec produces a broken
player rather than a fallback to something else.

### On Opus and error correction

libopus can add forward error correction with `-packet_loss N`. It is
deliberately not used here. FEC buys resilience over a lossy transport by
spending part of the bitrate on redundancy, so in a stored file it strictly
lowers quality at a fixed rate. What actually raises quality at 96k is
`-compression_level 10` (maximum analysis), `-frame_duration 60` (longest
frames, least per-packet overhead), true VBR, and `-application audio`. Those
are what the script sets.

### On AV1 and your GPU

Ampere cards, the 3090 and 3090 Ti included, have AV1 decode but no AV1 encode
silicon; `av1_nvenc` reports "No capable devices found". `--av1` therefore runs
SVT-AV1 on the CPU and is slow. `--nvenc` and `--hevc` do use the GPU.

The AV1 settings are two-pass, 10-bit, preset 4, with
`tune=0:film-grain=8:enable-overlays=1:enable-tf=1:enable-qm=1:qm-min=0:scd=1`.
Grain synthesis matters most: coding real grain at 1500k consumes the bitrate
that detail needs, so it is denoised out and re-synthesised at decode. 10-bit is
used even from an 8-bit source because the wider internal precision suppresses
banding, which is the first artefact a 1500k target produces.

## 9. Links without the /yt prefix

With a single route covering the domain, every form works at the root:

```
seaof.glass/dQw4w9WgXcQ          bare id
seaof.glass/dQw4w9WgXcQ.mp4      bare id, playable
seaof.glass/watch?v=dQw4w9WgXcQ
seaof.glass/youtu.be/dQw4w9WgXcQ
seaof.glass/youtube.com/watch?v=dQw4w9WgXcQ
seaof.glass/shorts/dQw4w9WgXcQ
```

The route to add is one line:

```
seaof.glass/*
```

### How the rest of the site keeps working

The worker now sits in front of every path, so anything it does not recognise
as a video link is handed straight back to the origin:

```ts
return fetch(request);
```

That works because **a worker's subrequest to its own zone goes to the origin
rather than back through the worker**. Verified against the live zone before
this was built: fetching `https://seaof.glass/tools/dns.html` from inside the
worker returned 200 with the real Pages content and GitHub's response headers,
with no loop.

Fetching `lasimeri.github.io` instead does *not* work, and it is the obvious
thing to reach for: GitHub Pages 301s that host to the custom domain, so a
pass-through built on it would bounce straight back into the worker. Use the
zone's own hostname.

Routes are matched most-specific-first, so `seaof.glass/s/*` continues to reach
the crystal worker and never touches this one.

### The one rule to remember

A bare id is recognised as *exactly eleven url-safe characters with no dot and
no slash*. Every existing path on the site is excluded by that, since each has
a dot or a slash. Do not create a top-level page whose name is exactly eleven
such characters, or it will be read as a video id.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Everything 404s | `BASE` and the route pattern disagree | Make them match, redeploy |
| Route did not register, `code: 10000` | Token lacks Zone > Workers Routes > Edit | See 3.3 |
| No embed in Discord | Discord cached an older scrape of that URL | Use an unseen video, or append `?cb=1` |
| "Video unavailable" on a live video | oEmbed returned 400 | Usually private, deleted, or region-blocked. Age-restricted videos also fail |
| Thumbnail is low resolution | That video has no `maxresdefault` still | Expected; the worker probes and falls back to `hqdefault` |
| npm install fails on peer deps | wrangler 4 vs workers-types ranges | `npm install --legacy-peer-deps` |
| Wrong video for a pasted link | Some other 11-character segment matched first | Report it with the link; the `v=` parameter always wins over path scanning |

Watch live requests:

```sh
npx wrangler tail
```

---

---

## 11. How it works

```
chat client sees seaof.glass/yt/<link>
        |
        +-- not a crawler? --> 302 to the watch page, done
        |
        v
extract the video id from the path and query
        |
        v
GET youtube.com/oembed  ->  title, channel, thumbnail
        |
        v
HEAD i.ytimg.com/.../maxresdefault.jpg  ->  use it if it exists
        |
        v
HTML page of OpenGraph tags
```

**Parsing note.** Pasting a full watch URL splits across two places: everything
before the `?` lands in the worker's pathname, everything after it becomes the
worker's own query string. So `/yt/https://youtube.com/watch?v=ID&t=30` arrives
as pathname `/yt/https://youtube.com/watch` plus search `?v=ID&t=30`. Both
halves are searched, and a valid `v=` parameter always wins.

**Security properties.** The redirect target is rebuilt from a validated
11-character id and a fixed origin, never from user input, so this cannot be
used as an open redirect. Timestamps and playlist ids are pattern-checked
before being carried through. Everything reaching a meta tag is HTML-escaped.
The oEmbed reflection is length-capped, pinned to a youtube.com URL, and served
as JSON with `nosniff`. There is a per-IP rate limit. Nothing is stored or
logged.

---

## 12. Known limits

- **No inline player.** Chat platforms play a direct media URL or an
  allowlisted player; a third-party page gets an image card. See
  `USE_PLAYER_CARD`.
- **Age-restricted videos have no oEmbed record** and render as unavailable.
- **oEmbed carries no duration, view count, or description.** Those need the
  Data API and a key, which is the dependency this project exists without.
- **Discord caches embeds per URL**, so testing needs fresh URLs.

---

## 13. Maintenance

```sh
npm run deploy
npx wrangler deployments list
npx wrangler rollback
npx wrangler tail
```

`npm run smoke` is safe to run any time and catches upstream breakage
immediately. There is no extraction logic and no signature descrambling here,
so there is no maintenance treadmill: the oEmbed endpoint is public and stable.
