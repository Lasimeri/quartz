// The .mp4 endpoint.
//
// A url ending in .mp4 that answers with video/mp4 is the one video
// path that works from any domain: chat clients play it as a plain
// media link, with no OpenGraph tags and therefore no allowlist in the
// way. Everything here exists to make that single url work for as many
// videos as possible.

import { CACHE_OK } from './config';
import { muxStream, planMux } from './mp4/mux';
import type { Env } from './env';
import { serveStored } from './relay';
import { fetchPlayer, pickMuxPair, pickProgressive, proxyMedia } from './stream';

/** Parse an inclusive byte range, clamped to the known size. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
	if (!header) return null;

	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null;

	let start: number;
	let end: number;
	if (m[1] === '') {
		// Suffix form: the last N bytes.
		const n = Number(m[2]);
		if (!n) return null;
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = Number(m[1]);
		end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
	}
	if (start > end || start >= size) return null;

	return { start, end };
}

function why(status: string, reason: string): Response {
	// Say what YouTube actually said. "No stream" for a video YouTube
	// refused to describe sends anyone debugging this in the wrong
	// direction, which is a mistake this endpoint made before.
	const text = status === 'LOGIN_REQUIRED'
		? `YouTube requires a signed-in session for this video, so no stream can be fetched.\n${reason}\n`
		: `YouTube will not serve this video: ${status}\n${reason}\n`;

	return new Response(text, {
		status: 502,
		headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
	});
}

/** Serve one video as a single playable mp4. */
export async function serveMedia(id: string, request: Request, env: Env): Promise<Response> {
	// A relayed file was fetched somewhere YouTube trusts, so it both
	// plays faster and covers videos the worker cannot reach itself.
	const stored = await serveStored(id, 'mp4', request, env);
	if (stored) return stored;

	// ?hd=1 forces the mux even when a progressive stream exists, which
	// is how you get 720p instead of the 360p single file.
	const forceMux = new URL(request.url).searchParams.has("hd");

	const player = await fetchPlayer(id);
	if (!player.ok) return why(player.status, player.reason);

	// A progressive format needs no muxing, so prefer it when offered.
	const progressiveFallback = pickProgressive(player.formats);
	const progressive = forceMux ? null : progressiveFallback;
	if (progressive?.url) return proxyMedia(progressive.url, request);

	// Otherwise combine an H.264 track with an AAC one on the fly.
	const pair = pickMuxPair(player.formats);
	if (!pair) {
		return new Response('no h264/aac pair available for this video\n', {
			status: 404,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}
	// Muxing reaches out to googlevideo several times and parses what
	// comes back, so it has real failure modes: an init range that
	// 403s, an index that is not a sidx, a truncated read. Any of those
	// used to surface as a bare 500. Catch them, say what happened, and
	// fall back to the progressive stream when one exists.
	let plan;
	try {
		plan = await planMux(pair.video, pair.audio);
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		if (progressiveFallback?.url) return proxyMedia(progressiveFallback.url, request);
		return new Response(`could not mux this video: ${detail}\n`, {
			status: 502,
			headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
		});
	}

	const wanted = parseRange(request.headers.get('Range'), plan.totalSize);

	const headers = new Headers({
		'Content-Type': 'video/mp4',
		'Accept-Ranges': 'bytes',
		'Cache-Control': `public, max-age=${CACHE_OK}`,
		'Access-Control-Allow-Origin': '*',
	});

	const start = wanted ? wanted.start : 0;
	const end = wanted ? wanted.end : plan.totalSize - 1;
	headers.set('Content-Length', String(end - start + 1));
	if (wanted) headers.set('Content-Range', `bytes ${start}-${end}/${plan.totalSize}`);

	// A HEAD still needs the layout, since that is where the size comes
	// from, but it must not fetch a byte of media.
	if (request.method === 'HEAD') {
		return new Response(null, { status: wanted ? 206 : 200, headers });
	}

	return new Response(muxStream(plan, start, end), { status: wanted ? 206 : 200, headers });
}
