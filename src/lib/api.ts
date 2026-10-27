/** JSON fetch for the app's own API, with user-facing error messages. */
export async function api<T>(url: string, { method, body }: { method?: string; body?: unknown } = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(url, {
			method: method ?? (body === undefined ? 'GET' : 'POST'),
			headers: body === undefined ? undefined : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		throw new Error(navigator.onLine ? 'Network error. Try again.' : "You're offline. Changes need a connection.");
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Something went wrong (HTTP ${res.status}).`);
	return data as T;
}
