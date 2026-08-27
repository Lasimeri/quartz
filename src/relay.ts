// Pre-muxed file storage.
//
// A trusted machine downloads and muxes a video, then PUTs it here.
// That machine's address is not a Cloudflare edge range, so YouTube
// serves it normally, which is the only reliable way to reach videos
// that answer LOGIN_REQUIRED from the worker.

import { CACHE_OK } from './config';
import type { Env } from './env';

const KEY_RE = /^[A-Za-z0-9_-]{11}$/;

function key(id: string): string {
	return `yt/${id}.mp4`;
}

/**
 * Constant-time comparison, so a wrong token cannot be recovered by
 * timing the rejection.
 */
function tokenMatches(given: string, expected: string): boolean {
	if (given.length !== expected.length) return false;

	let diff = 0;
	for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
	return diff === 0;
}

/** Serve a stored file, or null when this video is not cached. */
export async function serveStored(id: string, request: Request, env: Env): Promise<Response | null> {
	if (!env.STORE || !KEY_RE.test(id)) return null;

	// R2 parses the Range header itself and returns only that slice.
	const range = request.headers.get('Range');
	const object = await env.STORE.get(key(id), range ? { range: request.headers } : undefined);
	if (!object) return null;

	const headers = new Headers({
		'Content-Type': 'video/mp4',
		'Accept-Ranges': 'bytes',
		'Cache-Control': `public, max-age=${CACHE_OK}`,
		'Access-Control-Allow-Origin': '*',
		'X-Quartz-Source': 'r2',
	});
	object.writeHttpMetadata(headers);
	headers.set('Content-Type', 'video/mp4');

	const total = object.size;
	const r = object.range as { offset?: number; length?: number } | undefined;

	if (range && r && (r.offset !== undefined || r.length !== undefined)) {
		const start = r.offset ?? 0;
		const len = r.length ?? total - start;
		headers.set('Content-Range', `bytes ${start}-${start + len - 1}/${total}`);
		headers.set('Content-Length', String(len));
		return new Response(object.body, { status: 206, headers });
	}

	headers.set('Content-Length', String(total));
	if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
	return new Response(object.body, { status: 200, headers });
}

/**
 * Accept an upload from the trusted machine.
 *
 * Refuses unless RELAY_TOKEN is configured and matches, so a worker
 * deployed without the secret is closed rather than open.
 */
export async function storeUpload(id: string, request: Request, env: Env): Promise<Response> {
	if (!env.RELAY_TOKEN) {
		return new Response('uploads are not configured\n', { status: 503 });
	}
	if (!KEY_RE.test(id)) {
		return new Response('bad video id\n', { status: 400 });
	}

	const auth = request.headers.get('Authorization') || '';
	const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	if (!given || !tokenMatches(given, env.RELAY_TOKEN)) {
		return new Response('unauthorized\n', { status: 401 });
	}
	if (!request.body) {
		return new Response('empty body\n', { status: 400 });
	}

	await env.STORE.put(key(id), request.body, {
		httpMetadata: { contentType: 'video/mp4' },
	});

	const head = await env.STORE.head(key(id));
	return new Response(JSON.stringify({ id, stored: head?.size ?? null }) + '\n', {
		status: 201,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Remove a stored file. Same auth as upload. */
export async function deleteStored(id: string, request: Request, env: Env): Promise<Response> {
	if (!env.RELAY_TOKEN) return new Response('uploads are not configured\n', { status: 503 });
	if (!KEY_RE.test(id)) return new Response('bad video id\n', { status: 400 });

	const auth = request.headers.get('Authorization') || '';
	const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	if (!given || !tokenMatches(given, env.RELAY_TOKEN)) {
		return new Response('unauthorized\n', { status: 401 });
	}

	await env.STORE.delete(key(id));
	return new Response('deleted\n', { status: 200 });
}
