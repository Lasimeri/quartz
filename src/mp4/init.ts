// Combine two single-track DASH init segments into one two-track init.
//
// Both sources arrive as track_id 1, so the audio track is renumbered
// to 2 in its tkhd and its trex. Nothing else needs rewriting: sample
// data lives in the fragments, and those carry their own offsets.

import { buildBox, child, concat, find, u32, writeU32 } from './boxes';

export interface Init {
	ftyp: Uint8Array;
	moov: Uint8Array;
	mvhd: Uint8Array;
	trak: Uint8Array;
	trex: Uint8Array;
}

/** Byte offset of track_ID within a tkhd box, which moves with version. */
function tkhdTrackIdOffset(tkhd: Uint8Array): number {
	const ver = tkhd[8];
	// header(8) + version/flags(4) + creation + modification
	return ver === 1 ? 8 + 4 + 8 + 8 : 8 + 4 + 4 + 4;
}

function clone(b: Uint8Array): Uint8Array {
	return new Uint8Array(b);
}

/** Pull the pieces a mux needs out of one init segment. */
export function parseInit(b: Uint8Array): Init {
	const ftypBox = find(b, 'ftyp');
	const moovBox = find(b, 'moov');
	if (!ftypBox || !moovBox) throw new Error('init segment has no ftyp/moov');

	const moov = b.subarray(moovBox.start, moovBox.start + moovBox.size);
	const mvhd = child(moov, 'mvhd');
	const trak = child(moov, 'trak');
	const mvex = child(moov, 'mvex');
	const trex = mvex ? child(mvex, 'trex') : null;
	if (!mvhd || !trak || !trex) throw new Error('init segment missing mvhd/trak/trex');

	return {
		ftyp: b.subarray(ftypBox.start, ftypBox.start + ftypBox.size),
		moov,
		mvhd: clone(mvhd),
		trak: clone(trak),
		trex: clone(trex),
	};
}

/** Rewrite the track_ID inside a copied trak. */
function renumberTrak(trak: Uint8Array, id: number): Uint8Array {
	const out = clone(trak);
	const tkhd = find(out, 'tkhd', 8, out.length);
	if (!tkhd) throw new Error('trak has no tkhd');

	writeU32(out, tkhd.start + tkhdTrackIdOffset(out.subarray(tkhd.start)), id);
	return out;
}

/** Rewrite the track_ID inside a copied trex. */
function renumberTrex(trex: Uint8Array, id: number): Uint8Array {
	const out = clone(trex);
	writeU32(out, 12, id); // header(8) + version/flags(4)
	return out;
}

/**
 * next_track_ID is the final field of mvhd in both versions, so it can
 * be set from the end without branching on version.
 */
function setNextTrackId(mvhd: Uint8Array, id: number): Uint8Array {
	const out = clone(mvhd);
	writeU32(out, out.length - 4, id);
	return out;
}

/**
 * Build the two-track init segment.
 *
 * The video track keeps id 1 and the audio track becomes id 2, which
 * is the numbering the fragment rewriter then applies to audio moofs.
 */
export function buildCombinedInit(videoInit: Uint8Array, audioInit: Uint8Array): Uint8Array {
	const v = parseInit(videoInit);
	const a = parseInit(audioInit);

	const trakV = renumberTrak(v.trak, 1);
	const trakA = renumberTrak(a.trak, 2);
	const trexV = renumberTrex(v.trex, 1);
	const trexA = renumberTrex(a.trex, 2);

	const mvhd = setNextTrackId(v.mvhd, 3);
	const mvex = buildBox('mvex', trexV, trexA);
	const moov = buildBox('moov', mvhd, trakV, trakA, mvex);

	return concat([v.ftyp, moov]);
}

/** Track id currently written in a trak, for assertions and tests. */
export function trakId(trak: Uint8Array): number {
	const tkhd = find(trak, 'tkhd', 8, trak.length);
	if (!tkhd) throw new Error('trak has no tkhd');
	return u32(trak, tkhd.start + tkhdTrackIdOffset(trak.subarray(tkhd.start)));
}
