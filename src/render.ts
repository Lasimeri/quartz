// HTML and JSON the crawlers consume. Every value that reaches a meta
// tag passes through esc(); nothing here fetches anything.

import {
	BASE,
	CACHE_MISSING,
	CACHE_OK,
	MEDIA_HEIGHT,
	MEDIA_MODE,
	MEDIA_ORIGIN,
	MEDIA_WIDTH,
	THEME_COLOR,
} from './config';
import type { Target } from './youtube';
import type { Meta } from './youtube';

/** HTML entity escape for attribute-position interpolation. */
export function esc(s: string): string {
	return s.replace(/[&<>"']/g, c => (
		{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
	)[c]);
}

export function html(body: string, status = 200, maxAge = CACHE_OK): Response {
	return new Response(body, {
		status,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': `public, max-age=${maxAge}`,
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
		},
	});
}

/**
 * Video tags for the current mode.
 *
 * A direct mp4 in og:video is the only route to inline playback that
 * does not depend on the chat client's host allowlist: the client's own
 * player takes any single progressive file that answers Range requests.
 * Audio and video are one track there, so nothing has to stay in sync
 * at play time.
 */
function mediaTags(target: Target, host: string): string[] {
	if (MEDIA_MODE === 'off') {
		return ['<meta property="twitter:card" content="summary_large_image">'];
	}

	if (MEDIA_MODE === 'iframe') {
		// Mirrors what youtube.com emits on its own watch pages. Renders
		// only where the client allowlists youtube.com as a player host.
		const player = `https://www.youtube.com/embed/${target.id}`;
		return [
			'<meta property="twitter:card" content="player">',
			`<meta property="og:video" content="${esc(player)}">`,
			`<meta property="og:video:url" content="${esc(player)}">`,
			`<meta property="og:video:secure_url" content="${esc(player)}">`,
			'<meta property="og:video:type" content="text/html">',
			`<meta property="og:video:width" content="${MEDIA_WIDTH}">`,
			`<meta property="og:video:height" content="${MEDIA_HEIGHT}">`,
			`<meta property="twitter:player" content="${esc(player)}">`,
			`<meta property="twitter:player:width" content="${MEDIA_WIDTH}">`,
			`<meta property="twitter:player:height" content="${MEDIA_HEIGHT}">`,
		];
	}

	const media = MEDIA_MODE === 'external' && MEDIA_ORIGIN
		? `${MEDIA_ORIGIN}/${target.id}.mp4`
		: `https://${host}${BASE}/media/${target.id}.mp4`;

	// Proxied 360p is 640x360; an external backend advertises whatever
	// MEDIA_WIDTH/HEIGHT say it muxes.
	const w = MEDIA_MODE === 'external' ? MEDIA_WIDTH : 640;
	const h = MEDIA_MODE === 'external' ? MEDIA_HEIGHT : 360;

	return [
		'<meta property="twitter:card" content="player">',
		`<meta property="og:video" content="${esc(media)}">`,
		`<meta property="og:video:url" content="${esc(media)}">`,
		`<meta property="og:video:secure_url" content="${esc(media)}">`,
		'<meta property="og:video:type" content="video/mp4">',
		`<meta property="og:video:width" content="${w}">`,
		`<meta property="og:video:height" content="${h}">`,
		`<meta property="twitter:player:stream" content="${esc(media)}">`,
		'<meta property="twitter:player:stream:content_type" content="video/mp4">',
		`<meta property="twitter:player:width" content="${w}">`,
		`<meta property="twitter:player:height" content="${h}">`,
	];
}

/** The crawler-facing page: meta tags only, no visible body. */
export function videoPage(
	meta: Meta,
	target: Target,
	canonical: string,
	thumbnail: string,
	selfUrl: string,
	host: string,
): Response {
	const oembed = `https://${host}${BASE}/oembed?` + new URLSearchParams({
		a: meta.author,
		u: meta.authorUrl,
	});

	const tags = [
		'<meta charset="utf-8">',
		`<meta name="theme-color" content="${THEME_COLOR}">`,
		'<meta property="og:type" content="video.other">',
		`<meta property="og:site_name" content="${esc(host)}">`,
		`<meta property="og:url" content="${esc(canonical)}">`,
		`<meta property="og:title" content="${esc(meta.title)}">`,
		`<meta property="og:description" content="${esc(meta.author)}">`,
		`<meta property="og:image" content="${esc(thumbnail)}">`,
		// Only claim dimensions when the 1280x720 still is the one in use.
		...(thumbnail.includes('maxresdefault')
			? [
				'<meta property="og:image:width" content="1280">',
				'<meta property="og:image:height" content="720">',
			]
			: []),
		// Raw "&": crawlers fetch these bytes without entity-decoding, so
		// an escaped ampersand would mangle the query parameters.
		`<link rel="alternate" type="application/json+oembed" href="${oembed}" title="${esc(meta.author)}">`,
		...mediaTags(target, host),
		`<meta http-equiv="refresh" content="0;url=${esc(selfUrl)}">`,
	];

	return html(`<!DOCTYPE html><html><head>${tags.join('')}</head><body></body></html>`);
}

/** Shown when the video is deleted, private, or region-blocked. */
export function unavailablePage(canonical: string): Response {
	const tags = [
		'<meta charset="utf-8">',
		'<meta property="og:title" content="Video unavailable">',
		'<meta property="og:description" content="Deleted, private, or region-blocked.">',
		`<meta property="og:url" content="${esc(canonical)}">`,
	];
	return html(`<!DOCTYPE html><html><head>${tags.join('')}</head><body></body></html>`, 200, CACHE_MISSING);
}

/**
 * The oEmbed document crawlers fetch to fill the author line.
 *
 * Type must be "rich": a "link" type reads as having no embeddable
 * content and suppresses the title and description with it. Both
 * parameters are attacker-controllable, so the author is length-capped
 * and the url is pinned to a youtube.com path. Output is
 * JSON.stringify'd and served with nosniff, so the reflection is inert.
 */
export function oembedResponse(host: string, params: URLSearchParams): Response {
	const author = (params.get('a') || '').slice(0, 256);
	const url = params.get('u') || '';
	const safeUrl = /^https:\/\/www\.youtube\.com\//.test(url) ? url : 'https://www.youtube.com';

	return new Response(JSON.stringify({
		type: 'rich',
		version: '1.0',
		title: 'Embed',
		author_name: author,
		author_url: safeUrl,
		provider_name: host,
		provider_url: `https://${host}`,
	}), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': `public, max-age=${CACHE_OK}`,
			'X-Content-Type-Options': 'nosniff',
		},
	});
}
