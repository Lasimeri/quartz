#!/usr/bin/env node
//
// Reference media backend for quartz.
//
// Serves one progressive, faststart MP4 per video id at /<id>.mp4, with
// byte-range support, which is exactly what a chat client's native
// player needs. Audio and video are muxed here, server side, so nothing
// has to stay in sync at play time.
//
// Requires yt-dlp and ffmpeg on PATH. Run behind a TLS terminator
// (Caddy, nginx, a Cloudflare tunnel); this speaks plain HTTP.
//
//   PORT=8088 CACHE_DIR=/var/cache/quartz node backend/server.mjs
//
// Note that proxying third-party video is a YouTube terms violation and
// places your host in the delivery path for other people's copyrighted
// material. Run it for yourself, on your own hardware, knowingly.

import { createReadStream, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 8088);
const CACHE_DIR = process.env.CACHE_DIR || '/tmp/quartz-cache';
const MAX_HEIGHT = Number(process.env.MAX_HEIGHT || 720);
const MAX_FPS = Number(process.env.MAX_FPS || 60);
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** id -> promise, so concurrent requests share one mux instead of racing. */
const inFlight = new Map();

function run(cmd, args) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let err = '';
		p.stderr.on('data', d => { err += d; });
		p.on('error', reject);
		p.on('close', code => code === 0
			? resolve()
			: reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`)));
	});
}

/**
 * Produce a muxed file for `id`, or return the cached one.
 *
 * -movflags +faststart moves the moov atom to the front. Without it a
 * player must read the whole file before it can start, which defeats
 * streaming entirely.
 */
async function ensureFile(id) {
	const final = join(CACHE_DIR, `${id}.mp4`);
	try {
		await fs.access(final);
		return final;
	} catch { /* not cached yet */ }

	if (inFlight.has(id)) return inFlight.get(id);

	const work = (async () => {
		const tmp = join(CACHE_DIR, `${id}.part.mp4`);
		const fmt = `bestvideo[height<=${MAX_HEIGHT}][fps<=${MAX_FPS}][vcodec^=avc1]`
			+ `+bestaudio[acodec^=mp4a]/best[height<=${MAX_HEIGHT}]`;

		// H.264 plus AAC go straight into MP4 with no re-encode, so this
		// is IO-bound rather than CPU-bound. Falling back to a codec that
		// needs transcoding would change that completely.
		await run('yt-dlp', [
			'-f', fmt,
			'--merge-output-format', 'mp4',
			'--postprocessor-args', 'ffmpeg:-movflags +faststart',
			'--no-playlist',
			'--quiet',
			'-o', tmp,
			`https://www.youtube.com/watch?v=${id}`,
		]);

		await fs.rename(tmp, final);
		return final;
	})().finally(() => inFlight.delete(id));

	inFlight.set(id, work);
	return work;
}

function send(res, status, body, headers = {}) {
	res.writeHead(status, { 'Content-Type': 'text/plain', ...headers });
	res.end(body);
}

createServer(async (req, res) => {
	const url = new URL(req.url, 'http://localhost');
	const m = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\.mp4$/);

	if (!m || !ID_RE.test(m[1])) return send(res, 404, 'not found\n');
	const id = m[1];

	// A warm request starts the mux and returns immediately, so the file
	// is ready before anyone presses play. quartz fires one of these
	// when a crawler scrapes the page.
	if (url.searchParams.has('warm')) {
		ensureFile(id).catch(e => console.error(`warm ${id}:`, e.message));
		return send(res, 202, 'warming\n');
	}

	let file;
	try {
		file = await ensureFile(id);
	} catch (e) {
		console.error(`mux ${id}:`, e.message);
		return send(res, 502, 'could not prepare media\n');
	}

	const { size } = await fs.stat(file);
	const base = {
		'Content-Type': 'video/mp4',
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'public, max-age=86400',
		'Access-Control-Allow-Origin': '*',
	};

	// Range support is not optional: players seek, and a client that
	// cannot get a partial response will refuse to scrub.
	const range = req.headers.range;
	const parsed = range && /^bytes=(\d*)-(\d*)$/.exec(range);
	if (parsed) {
		const start = parsed[1] ? Number(parsed[1]) : 0;
		const end = parsed[2] ? Number(parsed[2]) : size - 1;
		if (start >= size || end >= size || start > end) {
			return send(res, 416, '', { 'Content-Range': `bytes */${size}` });
		}
		res.writeHead(206, {
			...base,
			'Content-Range': `bytes ${start}-${end}/${size}`,
			'Content-Length': end - start + 1,
		});
		if (req.method === 'HEAD') return res.end();
		return createReadStream(file, { start, end }).pipe(res);
	}

	res.writeHead(200, { ...base, 'Content-Length': size });
	if (req.method === 'HEAD') return res.end();
	createReadStream(file).pipe(res);
}).listen(PORT, async () => {
	await fs.mkdir(CACHE_DIR, { recursive: true });
	console.log(`quartz media backend on :${PORT}, cache ${CACHE_DIR}`);
});
