# quartz

A YouTube redirect on [seaof.glass](https://seaof.glass), with embeds that
say what the video actually is.

Paste any YouTube link behind `/yt/`:

```
https://youtu.be/dQw4w9WgXcQ
https://seaof.glass/yt/dQw4w9WgXcQ
https://seaof.glass/yt/https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30
```

Add `.mp4` and you get a video that plays in the chat window instead:

```
https://seaof.glass/yt/dQw4w9WgXcQ.mp4
```

Clicking still lands on YouTube. Crawlers get a card with the title, channel,
and a 1280x720 thumbnail.

**Why bother:** a bare `seaof.glass/yt/...` link would otherwise post as dead
text in chat. More usefully, the destination is a single constant, so pointing
viewers at a self-hosted frontend later is a one-line change and every link
already shared keeps working.

---

## Repository layout

| Path | What it does |
|---|---|
| `src/index.ts` | Routing: match the base path, redirect humans, serve crawlers |
| `src/config.ts` | Every knob worth turning (destination, base path, limits) |
| `src/youtube.ts` | Link parsing and oEmbed metadata |
| `src/render.ts` | Builds the meta tags and the oEmbed document |
| `src/home.ts` | The landing page at `/yt/` |
| `scripts/smoke.sh` | Tests a live deployment end to end |
| `wrangler.toml` | Worker name and route |

## Commands

```sh
npm install --legacy-peer-deps   # see SETUP.md for why the flag
npm run check                    # typecheck
npm run dev                      # local server
npm run deploy                   # ship it
npm run smoke                    # test the live deployment
```

## Accepted links

Everything below resolves to the same video. Scheme optional, URL-encoding
optional, trailing junk ignored.

```
/yt/dQw4w9WgXcQ
/yt/youtu.be/dQw4w9WgXcQ
/yt/https://www.youtube.com/watch?v=dQw4w9WgXcQ
/yt/youtube.com/shorts/dQw4w9WgXcQ
/yt/youtube.com/embed/dQw4w9WgXcQ
/yt/youtube.com/live/dQw4w9WgXcQ
```

`t=` and `list=` are carried through. Anything with no recognisable video id
returns 404, so the worker cannot be used as an open redirect.

## How it works

Crawler user agents get an HTML page of OpenGraph tags built from YouTube's
public oEmbed endpoint. No API key, no quota, no login, nothing that needs
maintaining. Everything else gets a 302.

## Licence

MIT. Not affiliated with YouTube or Google.
