// quartz - a youtube redirect with real embeds, on seaof.glass.
//
// Crawlers get OpenGraph tags built from YouTube's public oEmbed
// endpoint; humans get a 302 to the watch page. Only validated video
// ids reach the redirect, so the host cannot be used as an open
// redirect.
//
// In 'proxy' media mode the worker also serves the single-file 360p
// stream at <BASE>/media/<id>.mp4, which is what makes a chat client's
// native player work without depending on anyone's allowlist.
//
// Mounted under a path prefix (see BASE in config.ts) rather than a
// hostname, because seaof.glass itself is served by GitHub Pages.

import {
	BASE,
	BOT_UA,
	MEDIA_MODE,
	MEDIA_ORIGIN,
	RATE_LIMIT,
	RATE_WINDOW_MS,
	WATCH_ORIGIN,
} from './config';
import { homePage } from './home';
import { oembedResponse, unavailablePage, videoPage } from './render';
import { serveMedia } from './media';
import { bestThumbnail, fetchMeta, parseTarget, watchUrl } from './youtube';

// Per-isolate rate limit. Resets when the isolate recycles, which is
// enough to blunt single-IP hammering without external state.
const rateMap = new Map<string, number[]>();

function rateOk(ip: string): boolean {
	const now = Date.now();
	const hits = (rateMap.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
	if (hits.length >= RATE_LIMIT) return false;
	hits.push(now);
	rateMap.set(ip, hits);
	return true;
}

export default {
	async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('method not allowed', { status: 405 });
		}

		const url = new URL(request.url);
		const host = url.hostname;

		const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
		if (!rateOk(ip)) return new Response('rate limited', { status: 429 });

		// Everything below BASE; "" when the base path itself was hit.
		if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) {
			return new Response('not found', { status: 404 });
		}
		const rest = url.pathname.slice(BASE.length).replace(/^\//, '');

		if (rest === 'oembed') return oembedResponse(host, url.searchParams);
		if (rest === '') return homePage(host);

		// <BASE>/<id>.mp4 - a plain media link.
		//
		// This is the one video path that works from any domain: chat
		// clients play a url that ends in .mp4 and answers with
		// video/mp4, exactly as they would any other direct file link.
		// No OpenGraph tags are involved, so no allowlist applies. The
		// cost is that a media link carries no title or channel, which
		// is why the card at <BASE>/<id> still exists alongside it.
		const direct = /^(?:media\/)?([A-Za-z0-9_-]{11})\.mp4$/.exec(rest);
		if (direct) {
			return serveMedia(direct[1], request);
		}


		const target = parseTarget(rest, url.searchParams);
		if (!target) return new Response('no video id in that link', { status: 404 });

		const canonical = watchUrl(WATCH_ORIGIN, target);

		// Humans never see the meta-tag page.
		if (!BOT_UA.test(request.headers.get('User-Agent') || '')) {
			return new Response(null, {
				status: 302,
				headers: { 'Location': canonical, 'Cache-Control': 'no-store' },
			});
		}

		const meta = await fetchMeta(target.id);
		if (!meta) return unavailablePage(canonical);

		// An external backend has to mux before anyone presses play, so
		// start it as soon as the link is scraped. The proxy mode needs
		// no warming: it streams straight through.
		if (MEDIA_MODE === 'external' && MEDIA_ORIGIN) {
			ctx.waitUntil(
				fetch(`${MEDIA_ORIGIN}/${target.id}.mp4?warm=1`)
					.catch(() => { /* best effort; the card renders regardless */ }),
			);
		}

		const thumbnail = await bestThumbnail(target.id, meta.thumbnail);
		const selfUrl = `https://${host}${BASE}/${target.id}`;
		return videoPage(meta, target, canonical, thumbnail, selfUrl, host);
	},
};
