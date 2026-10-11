import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { Game, newGame } from './game';
import { upgradeGame } from './politics';

export type Session = { playerId: string; sequence: number; receipts: { sequence: number; digest: string; revision: number }[]; actions: number[] };
export type Envelope = { game: Game; sessions: Record<string, Session>; joins: Record<string, number[]> };
export interface Store {
  read(): Promise<Envelope>;
  transaction<T>(fn: (state: Envelope) => T): Promise<T>;
  close(): Promise<void>;
}
function initial(): Envelope { return { game: newGame(), sessions: {}, joins: {} }; }

/** All local writers (including multiple Node processes) acquire SQLite's write lock. */
export class SqliteStore implements Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS world (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL)');
    this.db.prepare('INSERT OR IGNORE INTO world VALUES (1, ?)').run(JSON.stringify(initial()));
  }
  async read(): Promise<Envelope> {
    const row = this.db.prepare('SELECT data FROM world WHERE id=1').get() as { data: string };
    const state = JSON.parse(row.data) as Envelope;
    state.game = upgradeGame(state.game); return state;
  }
  async transaction<T>(fn: (state: Envelope) => T): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT data FROM world WHERE id=1').get() as { data: string };
      const state = JSON.parse(row.data) as Envelope;
      state.game = upgradeGame(state.game);
      const result = fn(state);
      this.db.prepare('UPDATE world SET data=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async close() { this.db.close(); }
}

export class PostgresStore implements Store {
  private pool: Pool;
  constructor(connectionString: string) {
    // Transaction-pooler compatible: no named prepared statements or session locks.
    this.pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: true } });
    this.pool.on('error', error => console.error('Idle database connection error:', error.message));
  }
  async read(): Promise<Envelope> {
    const result = await this.pool.query('SELECT data FROM private.econrise_world WHERE id = 1');
    if (!result.rows[0]) throw new Error('Run the EconRise database migration first.');
    const state = result.rows[0].data as Envelope;
    state.game = upgradeGame(state.game); return state;
  }
  async transaction<T>(fn: (state: Envelope) => T): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '8s'");
      const result = await client.query('SELECT data FROM private.econrise_world WHERE id = 1 FOR UPDATE');
      if (!result.rows[0]) throw new Error('Run the EconRise database migration first.');
      const state = result.rows[0].data as Envelope;
      state.game = upgradeGame(state.game);
      const previousRevision = state.game.revision;
      const output = fn(state);
      await client.query('UPDATE private.econrise_world SET data = $1::jsonb WHERE id = 1', [JSON.stringify(state)]);
      if (state.game.revision !== previousRevision) {
        await client.query('UPDATE public.econrise_revisions SET revision = $1 WHERE id = 1', [state.game.revision]);
      }
      await client.query('COMMIT'); return output;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async close() { await this.pool.end(); }
}
let singleton: Store | undefined;
export function getStore(): Store {
  if (singleton) return singleton;
  const database = process.env.DATABASE_URL;
  if (database) singleton = new PostgresStore(database);
  else {
    if (process.env.VERCEL || (process.env.NODE_ENV === 'production' && process.env.ECONRISE_LOCAL !== '1')) {
      throw new Error('DATABASE_URL is required on Vercel and in production. SQLite is for explicit local use only.');
    }
    singleton = new SqliteStore(process.env.SQLITE_PATH || '.data/econrise.sqlite');
  }
  return singleton;
}
