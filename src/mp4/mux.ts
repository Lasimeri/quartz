// Streaming two-track mux.
//
// Because a moof+mdat pair is relocatable (see fragment.ts), the whole
// output layout is known before a single media byte is fetched: sizes
// come from the sidx, and rewriting never changes a fragment's length.
// That means Content-Length and Range both work, and memory never
// holds more than one span.

import { getRange, type Format } from '../stream';
import { readBox } from './boxes';
import { rewriteFragment } from './fragment';
import { buildCombinedInit } from './init';
import { parseSidx, type Fragment } from './sidx';

/** Fetch spans this large rather than one request per fragment. */
const SPAN_BYTES = 4 * 1024 * 1024;

interface Part {
	url: string;
	srcOffset: number;
	size: number;
	trackId: number;
	seq: number;
	/** Byte offset of this part within the output file. */
	outStart: number;
}

export interface MuxPlan {
	init: Uint8Array;
	parts: Part[];
	totalSize: number;
}

function range(r?: { start: string; end: string }): [number, number] {
	if (!r) throw new Error('format has no byte range');
	return [Number(r.start), Number(r.end)];
}

async function readTrack(f: Format): Promise<{ init: Uint8Array; fragments: Fragment[]; timescale: number }> {
	const [is, ie] = range(f.initRange);
	const [xs, xe] = range(f.indexRange);

	const init = await getRange(f.url!, is, ie);
	const idx = await getRange(f.url!, xs, xe);

	const box = readBox(idx, 0);
	if (!box || box.type !== 'sidx') {
		throw new Error(`expected sidx at ${xs}, found ${box ? box.type : 'nothing'}`);
	}

	const sidx = parseSidx(idx, box, xs);
	return { init, fragments: sidx.fragments, timescale: sidx.timescale };
}

/**
 * Work out the entire output layout without fetching any media.
 *
 * Fragments are emitted in presentation order across both tracks, which
 * is what lets a player start rendering immediately instead of buffering
 * one whole track first.
 */
export async function planMux(video: Format, audio: Format): Promise<MuxPlan> {
	const v = await readTrack(video);
	const a = await readTrack(audio);

	const init = buildCombinedInit(v.init, a.init);

	const queue = [
		...v.fragments.map(f => ({ t: f.time / v.timescale, f, url: video.url!, trackId: 1 })),
		...a.fragments.map(f => ({ t: f.time / a.timescale, f, url: audio.url!, trackId: 2 })),
	].sort((x, y) => x.t - y.t || x.trackId - y.trackId);

	const parts: Part[] = [];
	let out = init.length;
	let seq = 1;

	for (const item of queue) {
		parts.push({
			url: item.url,
			srcOffset: item.f.offset,
			size: item.f.size,
			trackId: item.trackId,
			seq: seq++,
			outStart: out,
		});
		out += item.f.size;
	}

	return { init, parts, totalSize: out };
}

/**
 * Reads a source file in spans, so consecutive fragments of one track
 * cost a single request between them. Without this a long video needs
 * one subrequest per fragment and runs into the per-request cap.
 */
class SpanReader {
	private buf: Uint8Array | null = null;
	private bufStart = 0;

	constructor(private url: string) {}

	async read(offset: number, size: number): Promise<Uint8Array> {
		if (!this.buf || offset < this.bufStart || offset + size > this.bufStart + this.buf.length) {
			const span = Math.max(SPAN_BYTES, size);
			this.buf = await getRange(this.url, offset, offset + span - 1);
			this.bufStart = offset;

			// A short read still has to satisfy this fragment.
			if (this.buf.length < size) {
				this.buf = await getRange(this.url, offset, offset + size - 1);
			}
		}
		const from = offset - this.bufStart;
		return this.buf.subarray(from, from + size);
	}
}

/**
 * Stream output bytes for the inclusive range [start, end].
 *
 * Parts outside the range are skipped without being fetched, so seeking
 * into the middle of a video costs only the spans it actually touches.
 */
export function muxStream(plan: MuxPlan, start: number, end: number): ReadableStream<Uint8Array> {
	const readers = new Map<string, SpanReader>();
	const reader = (url: string) => {
		let r = readers.get(url);
		if (!r) { r = new SpanReader(url); readers.set(url, r); }
		return r;
	};

	// Only the parts overlapping the requested window.
	const wanted = plan.parts.filter(p => p.outStart <= end && p.outStart + p.size > start);
	let i = 0;
	let sentInit = false;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				if (!sentInit) {
					sentInit = true;
					if (start < plan.init.length) {
						const to = Math.min(plan.init.length - 1, end);
						controller.enqueue(plan.init.subarray(start, to + 1));
					}
					if (end < plan.init.length) { controller.close(); return; }
					return;
				}

				if (i >= wanted.length) { controller.close(); return; }

				const p = wanted[i++];
				const raw = await reader(p.url).read(p.srcOffset, p.size);
				const frag = rewriteFragment(raw, p.trackId, p.seq);

				// Trim the first and last parts to the requested window.
				const from = Math.max(0, start - p.outStart);
				const to = Math.min(frag.length - 1, end - p.outStart);
				controller.enqueue(from === 0 && to === frag.length - 1
					? frag
					: frag.subarray(from, to + 1));
			} catch (e) {
				controller.error(e);
			}
		},
	});
}
