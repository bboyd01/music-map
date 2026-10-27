// Production entry. SvelteKit 3's adapter-node derives the request origin from the Host header
// and assumes https. When ORIGIN is set, pin every request to it instead, so CSRF checks and
// url.origin match the public URL (and plain-http local runs work). Clients can't spoof this:
// the headers below are always overwritten.
import process from 'node:process';

const origin = process.env.ORIGIN ? new URL(process.env.ORIGIN) : undefined;
const PROTO = 'x-music-map-proto';
const HOST = 'x-music-map-host';

if (origin) {
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
