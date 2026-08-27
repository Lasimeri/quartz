export interface Env {
	/** Bucket holding pre-muxed files, keyed by video id. */
	STORE: R2Bucket;
	/**
	 * Shared secret for the upload endpoint. Set with:
	 *   npx wrangler secret put RELAY_TOKEN
	 * Absent means uploads are refused outright rather than open.
	 */
	RELAY_TOKEN?: string;
}
