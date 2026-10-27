import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type DB = ReturnType<typeof openDb>;

/** Opens (creating if needed) the SQLite DB and applies pending migrations. Pass ':memory:' for tests. */
export function openDb(file: string, migrationsFolder = path.resolve('drizzle')) {
	if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
	const sqlite = new Database(file);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

/** Escapes `%`, `_` and `\\` for a LIKE pattern used with `escape '\\'`. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A transaction handle; accepted anywhere a DB is, so helpers compose inside transactions. */
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;
