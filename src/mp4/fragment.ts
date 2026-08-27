// Fragment rewriting.
//
// Because tfhd sets default-base-is-moof, every trun data_offset is
// relative to the start of its own moof. A moof+mdat pair is therefore
// relocatable: it can be placed anywhere in the output file without
// touching a single offset. Only two fields need changing, which is
// what makes this mux cheap enough to stream.

import { find, writeU32 } from './boxes';

/**
 * Retarget one moof+mdat pair.
 *
 * Returns a modified copy; the input is left alone so a cached
 * fragment can be reused for another output.
 */
export function rewriteFragment(
	fragment: Uint8Array,
	trackId: number,
	sequenceNumber: number,
): Uint8Array {
	const out = new Uint8Array(fragment);

	const moof = find(out, 'moof');
	if (!moof) throw new Error('fragment has no moof');

	const moofBytes = out.subarray(moof.start, moof.start + moof.size);

	const mfhd = find(moofBytes, 'mfhd', moof.headerSize, moofBytes.length);
	if (!mfhd) throw new Error('moof has no mfhd');
	// header(8) + version/flags(4)
	writeU32(out, moof.start + mfhd.start + 12, sequenceNumber);

	// tfhd sits inside moofBytes; locate it again to get an absolute offset.
	const traf = find(moofBytes, 'traf', moof.headerSize, moofBytes.length);
	if (!traf) throw new Error('moof has no traf');
	const tfhdBox = find(moofBytes, 'tfhd', traf.start + traf.headerSize, traf.start + traf.size);
	if (!tfhdBox) throw new Error('traf has no tfhd');
	// header(8) + version/flags(4)
	writeU32(out, moof.start + tfhdBox.start + 12, trackId);

	return out;
}

/** Confirm the relocatable-fragment assumption holds for this source. */
export function isRelocatable(fragment: Uint8Array): boolean {
	const moof = find(fragment, 'moof');
	if (!moof) return false;

	const moofBytes = fragment.subarray(moof.start, moof.start + moof.size);
	const traf = find(moofBytes, 'traf', moof.headerSize, moofBytes.length);
	if (!traf) return false;

	const tfhd = find(moofBytes, 'tfhd', traf.start + traf.headerSize, traf.start + traf.size);
	if (!tfhd) return false;

	// tfhd flags: header(8) + version(1) + flags(3); 0x020000 is
	// default-base-is-moof.
	const flags = ((moofBytes[tfhd.start + 9] << 16) |
		(moofBytes[tfhd.start + 10] << 8) |
		moofBytes[tfhd.start + 11]) >>> 0;
	return (flags & 0x020000) !== 0;
}
