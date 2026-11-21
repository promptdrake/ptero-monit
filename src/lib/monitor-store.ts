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
import { ObjectId } from 'mongodb';
import { db } from './sql.js';
import { DEFAULT_CUSTOM_BODY } from './webhook.js';

export interface MonitorSettings {
  panelUrl: string;
  ptlcApiKey: string;
  ptlaApiKey: string;
  discordEnabled: boolean;
  discordWebhookUrl: string;
  customEnabled: boolean;
  customWebhookUrl: string;
  customWebhookBody: string;
  autoCheckInterval: number;
  allowanceUsagePercent: number;
  cpuBurstMinutes: number;
}

export const defaultMonitorSettings: MonitorSettings = {
  panelUrl: '',
  ptlcApiKey: '',
  ptlaApiKey: '',
  discordEnabled: false,
  discordWebhookUrl: '',
  customEnabled: false,
  customWebhookUrl: '',
  customWebhookBody: DEFAULT_CUSTOM_BODY,
  autoCheckInterval: 60,
  allowanceUsagePercent: 80,
  cpuBurstMinutes: 10
};

export interface MonitoredServer {
  id: string;
  name: string;
  nodeId: string;
  nodeApiKey: string;
  wingsUrl: string;
  createdAt: string;
}

export interface MonitorLog {
  id: string;
  serverRowId: string;
  serverId: string;
  serverName: string;
  nodeId: string;
  event: string;
  detail: string;
  createdAt: string;
}

export interface MonitorLogInput {
  serverRowId: string;
  serverId: string;
  serverName: string;
  nodeId: string;
  event: string;
  detail: string;
}

let readyPromise: Promise<void> | null = null;
let ready = false;

function formatDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
  }
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
}

function toId(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

async function init(): Promise<void> {
  if (ready) return;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    if (db.type === 'mongodb') {
      ready = true;
      return;
    }

    const autoIdColumn =
      db.type === 'sqlite'
        ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
        : db.type === 'mysql'
          ? 'INT AUTO_INCREMENT PRIMARY KEY'
          : 'SERIAL PRIMARY KEY';

    await db.query(`
      CREATE TABLE IF NOT EXISTS monitor_settings (
        id INTEGER PRIMARY KEY,
        panel_url VARCHAR(500) DEFAULT '',
        ptlc_api_key VARCHAR(500) DEFAULT '',
        ptla_api_key VARCHAR(500) DEFAULT '',
        webhook_enabled INTEGER NOT NULL DEFAULT 0,
        webhook_url VARCHAR(1000) DEFAULT '',
        webhook_url_2 VARCHAR(1000) DEFAULT '',
        custom_webhook_enabled INTEGER NOT NULL DEFAULT 0,
        custom_webhook_body TEXT,
        auto_check_interval INTEGER NOT NULL DEFAULT 60,
        allowance_usage_percent INTEGER NOT NULL DEFAULT 80,
        cpu_burst_minutes INTEGER NOT NULL DEFAULT 10
      )
    `);

    try {
      await db.query(`ALTER TABLE monitor_settings ADD COLUMN webhook_url_2 VARCHAR(1000) DEFAULT ''`);
    } catch {
      // Column already exists on databases created with the previous schema.
    }

    try {
      await db.query(
        `ALTER TABLE monitor_settings ADD COLUMN custom_webhook_enabled INTEGER NOT NULL DEFAULT 0`
      );
    } catch {
      // Column already exists on databases created with the previous schema.
    }

    try {
      await db.query(`ALTER TABLE monitor_settings ADD COLUMN custom_webhook_body TEXT`);
    } catch {
      // Column already exists on databases created with the previous schema.
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS monitor_servers (
        id ${autoIdColumn},
        name VARCHAR(255) NOT NULL,
        node_id VARCHAR(100) NOT NULL,
        node_api_key VARCHAR(500) NOT NULL,
        wings_url VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS monitor_logs (
        id ${autoIdColumn},
        server_row_id VARCHAR(100) NOT NULL,
        server_id VARCHAR(100) NOT NULL,
        server_name VARCHAR(255) NOT NULL,
        node_id VARCHAR(100) NOT NULL,
        event VARCHAR(100) NOT NULL,
        detail TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    ready = true;
  })().catch((error) => {
    readyPromise = null;
    throw error;
  });

  return readyPromise;
}

function mapSettingsRow(row: any): MonitorSettings {
  return {
    panelUrl: String(row.panel_url ?? ''),
    ptlcApiKey: String(row.ptlc_api_key ?? ''),
    ptlaApiKey: String(row.ptla_api_key ?? ''),
    discordEnabled: Number(row.webhook_enabled) === 1,
    discordWebhookUrl: String(row.webhook_url ?? ''),
    customEnabled: Number(row.custom_webhook_enabled) === 1,
    customWebhookUrl: String(row.webhook_url_2 ?? ''),
    customWebhookBody: String(row.custom_webhook_body || DEFAULT_CUSTOM_BODY),
    autoCheckInterval: Number(row.auto_check_interval) || defaultMonitorSettings.autoCheckInterval,
    allowanceUsagePercent:
      Number(row.allowance_usage_percent) || defaultMonitorSettings.allowanceUsagePercent,
    cpuBurstMinutes: Number(row.cpu_burst_minutes) || defaultMonitorSettings.cpuBurstMinutes
  };
}

function mapServerRow(row: any): MonitoredServer {
  return {
    id: toId(row.id),
    name: String(row.name ?? ''),
    nodeId: String(row.node_id ?? ''),
    nodeApiKey: String(row.node_api_key ?? ''),
    wingsUrl: String(row.wings_url ?? ''),
    createdAt: formatDate(row.created_at)
  };
}

function mapServerDoc(doc: any): MonitoredServer {
  return {
    id: toId(doc._id),
    name: String(doc.name ?? ''),
    nodeId: String(doc.nodeId ?? ''),
    nodeApiKey: String(doc.nodeApiKey ?? ''),
    wingsUrl: String(doc.wingsUrl ?? ''),
    createdAt: formatDate(doc.createdAt)
  };
}

function mapLogRow(row: any): MonitorLog {
  return {
    id: toId(row.id),
    serverRowId: toId(row.server_row_id),
    serverId: String(row.server_id ?? ''),
    serverName: String(row.server_name ?? ''),
    nodeId: String(row.node_id ?? ''),
    event: String(row.event ?? ''),
    detail: String(row.detail ?? ''),
    createdAt: formatDate(row.created_at)
  };
}

function mapLogDoc(doc: any): MonitorLog {
  return {
    id: toId(doc._id),
    serverRowId: toId(doc.serverRowId),
    serverId: String(doc.serverId ?? ''),
    serverName: String(doc.serverName ?? ''),
    nodeId: String(doc.nodeId ?? ''),
    event: String(doc.event ?? ''),
    detail: String(doc.detail ?? ''),
    createdAt: formatDate(doc.createdAt)
  };
}

export async function getMonitorSettings(): Promise<MonitorSettings> {
  await init();

  if (db.type === 'mongodb') {
    const doc = await db.collection('monitor_settings').findOne({ _id: 'monitor_settings' as any });
    if (!doc) return { ...defaultMonitorSettings };
    return {
      panelUrl: String(doc.panelUrl ?? ''),
      ptlcApiKey: String(doc.ptlcApiKey ?? ''),
      ptlaApiKey: String(doc.ptlaApiKey ?? ''),
      discordEnabled: Boolean(doc.discordEnabled),
      discordWebhookUrl: String(doc.discordWebhookUrl ?? ''),
      customEnabled: Boolean(doc.customEnabled),
      customWebhookUrl: String(doc.customWebhookUrl ?? ''),
      customWebhookBody: String(doc.customWebhookBody || DEFAULT_CUSTOM_BODY),
      autoCheckInterval: Number(doc.autoCheckInterval) || defaultMonitorSettings.autoCheckInterval,
      allowanceUsagePercent:
        Number(doc.allowanceUsagePercent) || defaultMonitorSettings.allowanceUsagePercent,
      cpuBurstMinutes: Number(doc.cpuBurstMinutes) || defaultMonitorSettings.cpuBurstMinutes
    };
  }

  const result = await db.query('SELECT * FROM monitor_settings WHERE id = 1 LIMIT 1');
  if (!result.rows[0]) return { ...defaultMonitorSettings };
  return mapSettingsRow(result.rows[0]);
}

export async function saveMonitorSettings(next: MonitorSettings): Promise<MonitorSettings> {
  await init();

  const normalized: MonitorSettings = {
    panelUrl: String(next.panelUrl || '').trim(),
    ptlcApiKey: String(next.ptlcApiKey || '').trim(),
    ptlaApiKey: String(next.ptlaApiKey || '').trim(),
    discordEnabled: Boolean(next.discordEnabled),
    discordWebhookUrl: String(next.discordWebhookUrl || '').trim(),
    customEnabled: Boolean(next.customEnabled),
    customWebhookUrl: String(next.customWebhookUrl || '').trim(),
    customWebhookBody: String(next.customWebhookBody || DEFAULT_CUSTOM_BODY).trim(),
    autoCheckInterval: Math.max(1, Math.floor(Number(next.autoCheckInterval) || 1)),
    allowanceUsagePercent: Math.min(100, Math.max(1, Math.floor(Number(next.allowanceUsagePercent) || 1))),
    cpuBurstMinutes: Math.max(1, Math.floor(Number(next.cpuBurstMinutes) || 1))
  };

  if (db.type === 'mongodb') {
    await db.collection('monitor_settings').replaceOne(
      { _id: 'monitor_settings' as any },
      { ...normalized } as any,
      { upsert: true }
    );
    return normalized;
  }

  await db.query('DELETE FROM monitor_settings WHERE id = 1');
  await db.query(
    `INSERT INTO monitor_settings
      (id, panel_url, ptlc_api_key, ptla_api_key, webhook_enabled, webhook_url, webhook_url_2,
       custom_webhook_enabled, custom_webhook_body,
       auto_check_interval, allowance_usage_percent, cpu_burst_minutes)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.panelUrl,
      normalized.ptlcApiKey,
      normalized.ptlaApiKey,
      normalized.discordEnabled ? 1 : 0,
      normalized.discordWebhookUrl,
      normalized.customWebhookUrl,
      normalized.customEnabled ? 1 : 0,
      normalized.customWebhookBody,
      normalized.autoCheckInterval,
      normalized.allowanceUsagePercent,
      normalized.cpuBurstMinutes
    ]
  );

  return normalized;
}

export async function listServers(): Promise<MonitoredServer[]> {
  await init();

  if (db.type === 'mongodb') {
    const docs = await db.collection('monitor_servers').find({}).sort({ _id: -1 }).toArray();
    return docs.map(mapServerDoc);
  }

  const result = await db.query('SELECT * FROM monitor_servers ORDER BY id DESC');
  return result.rows.map(mapServerRow);
}

export async function getServer(id: string): Promise<MonitoredServer | null> {
  await init();

  if (db.type === 'mongodb') {
    if (!ObjectId.isValid(id)) return null;
    const doc = await db.collection('monitor_servers').findOne({ _id: new ObjectId(id) });
    return doc ? mapServerDoc(doc) : null;
  }

  const result = await db.query('SELECT * FROM monitor_servers WHERE id = ? LIMIT 1', [id]);
  return result.rows[0] ? mapServerRow(result.rows[0]) : null;
}

export async function addServer(input: {
  name: string;
  nodeId: string;
  nodeApiKey: string;
  wingsUrl: string;
}): Promise<MonitoredServer> {
  await init();

  const name = input.name.trim();
  const nodeId = input.nodeId.trim();
  const nodeApiKey = input.nodeApiKey.trim();
  const wingsUrl = input.wingsUrl.trim();

  if (db.type === 'mongodb') {
    const result = await db.collection('monitor_servers').insertOne({
      name,
      nodeId,
      nodeApiKey,
      wingsUrl,
      createdAt: new Date()
    });
    return {
      id: String(result.insertedId),
      name,
      nodeId,
      nodeApiKey,
      wingsUrl,
      createdAt: formatDate(new Date())
    };
  }

  if (db.type === 'postgresql') {
    const result = await db.query(
      `INSERT INTO monitor_servers (name, node_id, node_api_key, wings_url)
       VALUES (?, ?, ?, ?) RETURNING id, created_at`,
      [name, nodeId, nodeApiKey, wingsUrl]
    );
    return {
      id: toId(result.rows[0]?.id),
      name,
      nodeId,
      nodeApiKey,
      wingsUrl,
      createdAt: formatDate(result.rows[0]?.created_at)
    };
  }

  const result = await db.query(
    'INSERT INTO monitor_servers (name, node_id, node_api_key, wings_url) VALUES (?, ?, ?, ?)',
    [name, nodeId, nodeApiKey, wingsUrl]
  );

  return {
    id: toId(result.insertId),
    name,
    nodeId,
    nodeApiKey,
    wingsUrl,
    createdAt: formatDate(new Date())
  };
}

export async function deleteServer(id: string): Promise<boolean> {
  await init();

  if (db.type === 'mongodb') {
    if (!ObjectId.isValid(id)) return false;
    const result = await db.collection('monitor_servers').deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount > 0;
  }

  const result = await db.query('DELETE FROM monitor_servers WHERE id = ?', [id]);
  return (result.rowCount || 0) > 0;
}

export async function addMonitorLog(input: MonitorLogInput): Promise<void> {
  await init();

  if (db.type === 'mongodb') {
    await db.collection('monitor_logs').insertOne({
      serverRowId: input.serverRowId,
      serverId: input.serverId,
      serverName: input.serverName,
      nodeId: input.nodeId,
      event: input.event,
      detail: input.detail,
      createdAt: new Date()
    });
    return;
  }

  await db.query(
    `INSERT INTO monitor_logs
      (server_row_id, server_id, server_name, node_id, event, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.serverRowId, input.serverId, input.serverName, input.nodeId, input.event, input.detail]
  );
}

export async function listLogs(limit = 300): Promise<MonitorLog[]> {
  await init();

  if (db.type === 'mongodb') {
    const docs = await db
      .collection('monitor_logs')
      .find({})
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();
    return docs.map(mapLogDoc);
  }

  const result = await db.query(`SELECT * FROM monitor_logs ORDER BY id DESC LIMIT ${Number(limit) || 300}`);
  return result.rows.map(mapLogRow);
}

export async function countLogs(): Promise<number> {
  await init();

  if (db.type === 'mongodb') {
    return db.collection('monitor_logs').countDocuments({});
  }

  const result = await db.query('SELECT COUNT(*) AS total FROM monitor_logs');
  return Number(result.rows[0]?.total) || 0;
}

export async function listLogsPage(limit: number, offset: number): Promise<MonitorLog[]> {
  await init();

  const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));

  if (db.type === 'mongodb') {
    const docs = await db
      .collection('monitor_logs')
      .find({})
      .sort({ _id: -1 })
      .skip(safeOffset)
      .limit(safeLimit)
      .toArray();
    return docs.map(mapLogDoc);
  }

  const result = await db.query(
    `SELECT * FROM monitor_logs ORDER BY id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`
  );
  return result.rows.map(mapLogRow);
}

export async function deleteLog(id: string): Promise<boolean> {
  await init();

  if (db.type === 'mongodb') {
    if (!ObjectId.isValid(id)) return false;
    const result = await db.collection('monitor_logs').deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount > 0;
  }

  const result = await db.query('DELETE FROM monitor_logs WHERE id = ?', [id]);
  return (result.rowCount || 0) > 0;
}

export async function deleteAllLogs(): Promise<number> {
  await init();

  if (db.type === 'mongodb') {
    const result = await db.collection('monitor_logs').deleteMany({});
    return result.deletedCount;
  }

  const result = await db.query('DELETE FROM monitor_logs');
  return result.rowCount || 0;
}
