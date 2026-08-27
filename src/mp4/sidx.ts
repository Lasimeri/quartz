// Segment index. YouTube puts a sidx right after the init segment; it
// maps each fragment to a byte length and a duration, which is all the
// muxer needs to fetch fragments individually and interleave them in
// time order without ever reading the media payload.

import { u32, u64, type Box } from './boxes';

export interface Fragment {
	/** Absolute byte offset of the moof within the source file. */
	offset: number;
	/** Length of the moof+mdat pair. */
	size: number;
	/** Duration in the sidx timescale. */
	duration: number;
	/** Presentation start, in the sidx timescale. */
	time: number;
}

export interface SidxInfo {
	timescale: number;
	fragments: Fragment[];
}

/**
 * Parse a sidx.
 *
 * `sidxFileOffset` is where this box begins in the source file, needed
 * because fragment offsets are expressed relative to the end of the
 * box plus first_offset.
 */
export function parseSidx(b: Uint8Array, box: Box, sidxFileOffset: number): SidxInfo {
	let o = box.start + box.headerSize;
	const ver = b[o];
	o += 4; // version + flags

	o += 4; // reference_ID
	const timescale = u32(b, o);
	o += 4;

	let earliest: number;
	let firstOffset: number;
	if (ver === 0) {
		earliest = u32(b, o); o += 4;
		firstOffset = u32(b, o); o += 4;
	} else {
		earliest = u64(b, o); o += 8;
		firstOffset = u64(b, o); o += 8;
	}

	o += 2; // reserved
	const count = (b[o] << 8) + b[o + 1];
	o += 2;

	// Fragments follow the sidx box, displaced by first_offset.
	let cursor = sidxFileOffset + box.size + firstOffset;
	let time = earliest;

	const fragments: Fragment[] = [];
	for (let i = 0; i < count; i++) {
		const word = u32(b, o);
		// High bit distinguishes a nested sidx from media; YouTube only
		// emits media references, so a nested one means our assumptions
		// about this file are wrong and stopping beats guessing.
		if ((word & 0x80000000) !== 0) break;

		const size = word & 0x7fffffff;
		const duration = u32(b, o + 4);
		o += 12;

		fragments.push({ offset: cursor, size, duration, time });
		cursor += size;
		time += duration;
	}

	return { timescale, fragments };
}
