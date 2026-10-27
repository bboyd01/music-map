// Production entry. SvelteKit 3's adapter-node derives the request origin from the Host header
// and assumes https. When ORIGIN is set, pin every request to it instead, so CSRF checks and
// url.origin match the public URL (and plain-http local runs work). Clients can't spoof this:
// the headers below are always overwritten.
import process from 'node:process';

/** Accepts "music.example.com", "https://music.example.com/", quoted values, etc. */
function normalizeOrigin(raw) {
	const value = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
	if (!value) return undefined;
	try {
		const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
		return url;
	} catch {
		console.error(`ORIGIN must be the app's public URL, like https://music.example.com (got ${JSON.stringify(raw)}).`);
		process.exit(1);
	}
}

const origin = process.env.ORIGIN ? normalizeOrigin(process.env.ORIGIN) : undefined;
const PROTO = 'x-music-map-proto';
const HOST = 'x-music-map-host';

if (origin) {
	process.env.ORIGIN = origin.origin;
	process.env.PROTOCOL_HEADER = PROTO;
	process.env.HOST_HEADER = HOST;
}

const { server } = await import('./build/index.js');

if (origin) {
	const proto = origin.protocol.slice(0, -1);
	server.prependListener('request', (req) => {
		req.headers[PROTO] = proto;
		req.headers[HOST] = origin.host;
	});
}
