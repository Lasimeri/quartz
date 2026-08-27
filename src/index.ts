// quartz - a youtube redirect with real embeds, on seaof.glass.
//
// Crawlers get OpenGraph tags built from YouTube's public oEmbed
// endpoint; humans get a 302 to the watch page. Only validated video
// ids reach the redirect, so the host cannot be used as an open
// redirect.
//
// Mounted under a path prefix (see BASE in config.ts) rather than a
// hostname, because seaof.glass itself is served by GitHub Pages.

import { BASE, BOT_UA, RATE_LIMIT, RATE_WINDOW_MS, WATCH_ORIGIN } from './config';
import { homePage } from './home';
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

export default {
	async fetch(request: Request): Promise<Response> {
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

		const thumbnail = await bestThumbnail(target.id, meta.thumbnail);
		const selfUrl = `https://${host}${BASE}/${target.id}`;
		return videoPage(meta, target, canonical, thumbnail, selfUrl, host);
	},
};
