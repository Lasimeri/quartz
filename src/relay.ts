// Pre-muxed file storage.
//
// A trusted machine downloads and muxes a video, then PUTs it here.
// That machine's address is not a Cloudflare edge range, so YouTube
// serves it normally, which is the only reliable way to reach videos
// that answer LOGIN_REQUIRED from the worker.

import { CACHE_OK } from './config';
import type { Env } from './env';

/** Containers the relay accepts. H.264/AAC in MP4, VP9 or AV1 in WebM. */
export type Ext = 'mp4' | 'webm';

export const MIME: Record<Ext, string> = {
	mp4: 'video/mp4',
	webm: 'video/webm',
};

export function isExt(s: string): s is Ext {
	return s === 'mp4' || s === 'webm';
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function key(id: string, ext: Ext): string {
	return `yt/${id}.${ext}`;
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

function authorized(request: Request, env: Env): boolean {
	if (!env.RELAY_TOKEN) return false;

	const auth = request.headers.get('Authorization') || '';
	const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	return given.length > 0 && tokenMatches(given, env.RELAY_TOKEN);
}

/** Serve a stored file, or null when this video is not cached. */
export async function serveStored(
	id: string,
	ext: Ext,
	request: Request,
	env: Env,
): Promise<Response | null> {
	if (!env.STORE || !ID_RE.test(id)) return null;

	// R2 parses the Range header itself and returns only that slice.
	const range = request.headers.get('Range');
	const object = await env.STORE.get(key(id, ext), range ? { range: request.headers } : undefined);
	if (!object) return null;

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('Content-Type', MIME[ext]);
	headers.set('Accept-Ranges', 'bytes');
	headers.set('Cache-Control', `public, max-age=${CACHE_OK}`);
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('X-Quartz-Source', 'r2');

	const total = object.size;
	const r = object.range as { offset?: number; length?: number } | undefined;

	if (range && r && (r.offset !== undefined || r.length !== undefined)) {
		const start = r.offset ?? 0;
		const len = r.length ?? total - start;
		headers.set('Content-Range', `bytes ${start}-${start + len - 1}/${total}`);
		headers.set('Content-Length', String(len));
		return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
	}

	headers.set('Content-Length', String(total));
	return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}

/**
 * Accept an upload from the trusted machine.
 *
 * Refuses unless RELAY_TOKEN is configured and matches, so a worker
 * deployed without the secret is closed rather than open.
 */
export async function storeUpload(
	id: string,
	ext: Ext,
	request: Request,
	env: Env,
): Promise<Response> {
	if (!env.RELAY_TOKEN) return new Response('uploads are not configured\n', { status: 503 });
	if (!ID_RE.test(id)) return new Response('bad video id\n', { status: 400 });
	if (!authorized(request, env)) return new Response('unauthorized\n', { status: 401 });
	if (!request.body) return new Response('empty body\n', { status: 400 });

	await env.STORE.put(key(id, ext), request.body, {
		httpMetadata: { contentType: MIME[ext] },
	});

	const head = await env.STORE.head(key(id, ext));
	return new Response(JSON.stringify({ id, ext, stored: head?.size ?? null }) + '\n', {
		status: 201,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Remove a stored file. Same auth as upload. */
export async function deleteStored(
	id: string,
	ext: Ext,
	request: Request,
	env: Env,
): Promise<Response> {
	if (!env.RELAY_TOKEN) return new Response('uploads are not configured\n', { status: 503 });
	if (!ID_RE.test(id)) return new Response('bad video id\n', { status: 400 });
	if (!authorized(request, env)) return new Response('unauthorized\n', { status: 401 });

	await env.STORE.delete(key(id, ext));
	return new Response('deleted\n', { status: 200 });
}
