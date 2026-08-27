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
8. [Troubleshooting](#8-troubleshooting)
9. [How it works](#9-how-it-works)
10. [Known limits](#10-known-limits)
11. [Maintenance](#11-maintenance)

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

`MEDIA_MODE` in `src/config.ts` decides how the embed offers video.

| Mode | Playback | Needs |
|---|---|---|
| `off` | Thumbnail only | Nothing |
| `iframe` | Only where the client allowlists youtube.com | Nothing |
| `proxy` (default) | Real inline playback, 360p | Nothing |
| `external` | Real inline playback, any quality you mux | A backend |

### Why `proxy` is the default

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

## 8. Troubleshooting


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

## 9. How it works

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

## 10. Known limits

- **No inline player.** Chat platforms play a direct media URL or an
  allowlisted player; a third-party page gets an image card. See
  `USE_PLAYER_CARD`.
- **Age-restricted videos have no oEmbed record** and render as unavailable.
- **oEmbed carries no duration, view count, or description.** Those need the
  Data API and a key, which is the dependency this project exists without.
- **Discord caches embeds per URL**, so testing needs fresh URLs.

---

## 11. Maintenance

```sh
npm run deploy
npx wrangler deployments list
npx wrangler rollback
npx wrangler tail
```

`npm run smoke` is safe to run any time and catches upstream breakage
immediately. There is no extraction logic and no signature descrambling here,
so there is no maintenance treadmill: the oEmbed endpoint is public and stable.
