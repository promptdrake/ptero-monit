/*

╭━━╮╱╱╱╱╱╱╱╱╱╭━━━╮╱╱╱╱╱╱╱╱╱╱╱╭╮
╰┫┣╯╱╱╱╱╱╱╱╱╱┃╭━╮┃╱╱╱╱╭╮╱╱╱╱╭╯╰╮
╱┃┃╭━━┳━━┳━╮╱┃╰━╯┣━┳━━╋╋━━┳━┻╮╭╯
╱┃┃┃╭╮┃╭╮┃╭╮╮┃╭━━┫╭┫╭╮┣┫┃━┫╭━┫┃
╭┫┣┫╰╯┃╭╮┃┃┃┃┃┃╱╱┃┃┃╰╯┃┃┃━┫╰━┫╰╮
╰━━┫╭━┻╯╰┻╯╰╯╰╯╱╱╰╯╰━━┫┣━━┻━━┻━╯
╱╱╱┃┃╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╭╯┃
╱╱╱╰╯╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╰━╯
*/
import path from 'path';
import fs from 'fs';
import mysql, { Pool as MySQLPool } from 'mysql2/promise';
import pg from 'pg';
import Database, { Database as SQLiteDB } from 'better-sqlite3';
import { MongoClient, Db as MongoDatabase } from 'mongodb';

export type SupportedDB = 'mysql' | 'postgresql' | 'sqlite' | 'mongodb';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
  insertId?: number | string;
}


class UniversalDatabase {
  public type: SupportedDB;

  public mysqlPool?: MySQLPool;
  public pgPool?: pg.Pool;
  public sqliteDb?: SQLiteDB;
  public mongoClient?: MongoClient;
  public mongoDb?: MongoDatabase;

  constructor() {
    this.type = (process.env.DB_TYPE?.toLowerCase() as SupportedDB) || 'sqlite';
    this.init();
  }

  private init() {
    switch (this.type) {
      case 'mysql': {
        this.mysqlPool = mysql.createPool({
          host: process.env.MYSQL_HOST || 'localhost',
          port: Number(process.env.MYSQL_PORT) || 3306,
          user: process.env.MYSQL_USER || 'root',
          password: process.env.MYSQL_PASSWORD || '',
          database: process.env.MYSQL_DATABASE || 'test',
          waitForConnections: true,
          connectionLimit: 10
        });
        break;
      }
      case 'postgresql': {
        const { Pool } = pg;
        this.pgPool = new Pool({
          connectionString: process.env.PG_URL,
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || 'postgres',
          password: process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
          max: 10
        });
        break;
      }
      case 'sqlite': {
        const dbPath = process.env.SQLITE_FILE || 'data/app.db';
        if (dbPath !== ':memory:') {
          const dir = path.dirname(path.resolve(process.cwd(), dbPath));
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
        }
        this.sqliteDb = new Database(dbPath);
        this.sqliteDb.pragma('journal_mode = WAL');
        break;
      }
      case 'mongodb': {
        const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
        const dbName = process.env.MONGO_DATABASE || 'test';
        this.mongoClient = new MongoClient(uri);
        this.mongoDb = this.mongoClient.db(dbName);
        break;
      }
    }
  }
  public async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    switch (this.type) {
      case 'mysql': {
        if (!this.mysqlPool) throw new Error('MySQL pool not initialized');
        const [results]: any = await this.mysqlPool.query(sql, params);
        if (Array.isArray(results)) {
          return { rows: results, rowCount: results.length };
        }
        return {
          rows: [],
          rowCount: results.affectedRows,
          insertId: results.insertId
        };
      }

      case 'postgresql': {
        if (!this.pgPool) throw new Error('PostgreSQL pool not initialized');
        let idx = 1;
        const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
        const res = await this.pgPool.query(pgSql, params);
        return {
          rows: res.rows,
          rowCount: res.rowCount ?? 0
        };
      }

      case 'sqlite': {
        if (!this.sqliteDb) throw new Error('SQLite database not initialized');
        const trimmed = sql.trim().toLowerCase();
        const stmt = this.sqliteDb.prepare(sql);

        if (trimmed.startsWith('select') || trimmed.startsWith('pragma') || trimmed.startsWith('explain')) {
          const rows = stmt.all(...params) as T[];
          return { rows, rowCount: rows.length };
        } else {
          const info = stmt.run(...params);
          return {
            rows: [],
            rowCount: info.changes,
            insertId: Number(info.lastInsertRowid)
          };
        }
      }

      case 'mongodb': {
        if (!this.mongoDb) throw new Error('MongoDB database not initialized');
        throw new Error(
          'For MongoDB, use db.mongoDb.collection("name") or db.find/db.insertOne helper methods.'
        );
      }

      default:
        throw new Error(`Unsupported database type: ${this.type}`);
    }
  }

 
  public collection(name: string) {
    if (!this.mongoDb) {
      throw new Error('Active database is not MongoDB. Current is: ' + this.type);
    }
    return this.mongoDb.collection(name);
  }

  public async testConnection(): Promise<{ success: boolean; type: string; message: string }> {
    try {
      if (this.type === 'mongodb') {
        if (!this.mongoClient) throw new Error('MongoDB client not initialized');
        await this.mongoClient.connect();
        await this.mongoDb?.command({ ping: 1 });
        return { success: true, type: this.type, message: 'Connected to MongoDB successfully' };
      }

      if (this.type === 'sqlite') {
        this.query('SELECT 1 as test');
        return { success: true, type: this.type, message: 'Connected to SQLite successfully' };
      }

      await this.query('SELECT 1 as test');
      return { success: true, type: this.type, message: `Connected to ${this.type} successfully` };
    } catch (err: any) {
      return { success: false, type: this.type, message: err.message };
    }
  }
}
export const db = new UniversalDatabase();
