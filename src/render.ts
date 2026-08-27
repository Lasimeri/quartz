// HTML and JSON the crawlers consume. Every value that reaches a meta
// tag passes through esc(); nothing here fetches anything.

import { CACHE_MISSING, CACHE_OK, THEME_COLOR, USE_PLAYER_CARD } from './config';
import type { Meta, Target } from './youtube';

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

/** The crawler-facing page: meta tags only, no visible body. */
export function videoPage(
	meta: Meta,
	target: Target,
	canonical: string,
	thumbnail: string,
	selfUrl: string,
	host: string,
): Response {
	const oembed = `https://${host}/yt/oembed?` + new URLSearchParams({
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
		// Raw "&": crawlers fetch these bytes without entity-decoding, so
		// an escaped ampersand would mangle the query parameters.
		`<link rel="alternate" type="application/json+oembed" href="${oembed}" title="${esc(meta.author)}">`,
	];

	if (USE_PLAYER_CARD) {
		const player = `https://www.youtube-nocookie.com/embed/${target.id}`;
		tags.push(
			'<meta property="twitter:card" content="player">',
			`<meta property="twitter:player" content="${esc(player)}">`,
			'<meta property="twitter:player:width" content="1280">',
			'<meta property="twitter:player:height" content="720">',
		);
	} else {
		tags.push('<meta property="twitter:card" content="summary_large_image">');
	}

	tags.push(`<meta http-equiv="refresh" content="0;url=${esc(selfUrl)}">`);
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
 * and the url is pinned to a youtube.com channel path. Output is
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
