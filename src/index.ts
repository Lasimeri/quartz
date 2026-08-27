// quartz - a youtube redirect with real embeds, on seaof.glass.
//
// Crawlers get OpenGraph tags built from YouTube's public oEmbed
// endpoint; humans get a 302 to the watch page. Only validated video
// ids reach the redirect, so the host cannot be used as an open
// redirect.
//
// Links work with or without the /yt prefix: paths that already look
// like a youtube link (/watch?v=, /youtu.be/, /shorts/) are handled
// wherever they appear, so seaof.glass/watch?v=ID works directly. The
// prefix still exists for bare ids, which cannot be told apart from
// ordinary site paths.

import { BASE, BOT_UA, MEDIA_MODE, MEDIA_ORIGIN, RATE_LIMIT, RATE_WINDOW_MS, WATCH_ORIGIN } from './config';
import type { Env } from './env';
import { homePage } from './home';
import { serveMedia } from './media';
import { deleteStored, storeUpload } from './relay';
import { oembedResponse, unavailablePage, videoPage } from './render';
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

/** Paths that are unmistakably youtube links even without the prefix. */
const ROOT_SHAPES = /^(watch|youtu\.be\/|shorts\/|embed\/|live\/|v\/|https?:)/i;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const host = url.hostname;
		const method = request.method;

		// Everything under the prefix, or the bare path when a link shape
		// was pasted straight after the domain.
		const underBase = url.pathname === BASE || url.pathname.startsWith(`${BASE}/`);
		const rest = underBase
			? url.pathname.slice(BASE.length).replace(/^\//, '')
			: url.pathname.replace(/^\//, '');

		// Uploads from a trusted machine. Checked before the read-only
		// guard below, since these are the only writes the worker takes.
		const store = /^store\/([A-Za-z0-9_-]{11})$/.exec(rest);
		if (store && underBase) {
			if (method === 'PUT') return storeUpload(store[1], request, env);
			if (method === 'DELETE') return deleteStored(store[1], request, env);
			return new Response('method not allowed', { status: 405 });
		}

		if (method !== 'GET' && method !== 'HEAD') {
			return new Response('method not allowed', { status: 405 });
		}

		const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
		if (!rateOk(ip)) return new Response('rate limited', { status: 429 });

		if (!underBase && !ROOT_SHAPES.test(rest)) {
			return new Response('not found', { status: 404 });
		}

		if (underBase) {
			if (rest === 'oembed') return oembedResponse(host, url.searchParams);
			if (rest === '') return homePage(host);
		}

		// <BASE>/<id>.mp4 - a plain media link.
		//
		// This is the one video path that works from any domain: chat
		// clients play a url that ends in .mp4 and answers with
		// video/mp4, exactly as they would any other direct file link.
		// No OpenGraph tags are involved, so no allowlist applies. The
		// cost is that a media link carries no title or channel, which
		// is why the card at <BASE>/<id> still exists alongside it.
		const direct = /^(?:media\/)?([A-Za-z0-9_-]{11})\.mp4$/.exec(rest);
		if (direct) return serveMedia(direct[1], request, env);

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
		// start it as soon as the link is scraped.
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
