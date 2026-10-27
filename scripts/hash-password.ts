/**
 * Prints an APP_PASSWORD_HASH value.
 *   npx tsx scripts/hash-password.ts            (prompts, input hidden)
 *   echo -n 'secret' | npx tsx scripts/hash-password.ts
 */
import { stdin, stdout, stderr } from 'node:process';
import { hashPassword } from '../src/lib/server/auth/password.ts';

async function readHidden(prompt: string): Promise<string> {
	stderr.write(prompt);
	stdin.setRawMode(true);
	stdin.resume();
	stdin.setEncoding('utf8');
	let value = '';
	return new Promise((resolve) => {
		stdin.on('data', (chunk: string) => {
			for (const ch of chunk) {
				if (ch === '\r' || ch === '\n') {
					stdin.setRawMode(false);
					stdin.pause();
					stderr.write('\n');
					return resolve(value);
				}
				if (ch === '\u0003') process.exit(130);
				if (ch === '\u007f') value = value.slice(0, -1);
				else value += ch;
			}
		});
	});
}

async function readPiped(): Promise<string> {
	let data = '';
	for await (const chunk of stdin) data += chunk;
	return data.replace(/\r?\n$/, '');
}

const password = stdin.isTTY ? await readHidden('Password: ') : await readPiped();
if (stdin.isTTY && password !== (await readHidden('Confirm:  '))) {
	stderr.write('Passwords do not match.\n');
	process.exit(1);
}
if (password.length < 8) {
	stderr.write('Use at least 8 characters.\n');
	process.exit(1);
}
stdout.write((await hashPassword(password)) + '\n');
