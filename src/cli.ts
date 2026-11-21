#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import chalk from 'chalk';
import bcrypt from 'bcryptjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

async function loadDatabase() {
  const module = await import('./lib/sql.js');
  return module.db;
}

type Database = Awaited<ReturnType<typeof loadDatabase>>;

async function closeDatabase(database: Database): Promise<void> {
  try {
    if (database.sqliteDb) database.sqliteDb.close();
    if (database.mysqlPool) await database.mysqlPool.end();
    if (database.pgPool) await database.pgPool.end();
    if (database.mongoClient) await database.mongoClient.close();
  } catch {
  
  }
}

async function withDatabase<T>(run: (database: Database) => Promise<T>): Promise<T> {
  const database = await loadDatabase();
  try {
    return await run(database);
  } finally {
    await closeDatabase(database);
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write(question);
    return Promise.resolve(readPipedLine());
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

let pipedLines: string[] | null = null;

function readPipedLine(): string {
  if (!pipedLines) {
    const data = fs.readFileSync(0, 'utf8');
    pipedLines = data.split(/\r?\n/);
  }
  return (pipedLines.shift() || '').trim();
}

function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write(question);
    return Promise.resolve(readPipedLine());
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';

    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    };

    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');

      if (text === '\r' || text === '\n' || text === '\u0004') {
        finish();
        resolve(value);
        return;
      }
      if (text === '\u0003') {
        finish();
        process.exit(130);
      }
      if (text === '\u007f' || text === '\b') {
        value = value.slice(0, -1);
        return;
      }

      value += text;
      stdout.write('*');
    };

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function parseOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;

    const [rawKey, ...rest] = arg.slice(2).split('=');
    if (rest.length > 0) {
      options[rawKey] = rest.join('=');
    } else if (args[index + 1] && !args[index + 1].startsWith('--')) {
      options[rawKey] = args[index + 1];
      index++;
    } else {
      options[rawKey] = 'true';
    }
  }

  return options;
}

function printHeader(title: string): void {
  console.log('');
  console.log(chalk.bold.cyan(title));
  console.log(chalk.gray('─'.repeat(Math.max(12, title.length))));
}

async function ensureAdminsTable(database: Database): Promise<void> {
  if (database.type === 'mongodb') return;

  if (database.type === 'postgresql') {
    await database.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    return;
  }

  if (database.type === 'mysql') {
    await database.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    return;
  }

  await database.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function resetCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);

  printHeader('Reset Administrator Account');
  console.log(chalk.gray('Press Ctrl+C to cancel.'));
  console.log('');

  const username = (options.username || (await ask('New Username: '))).trim();
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) {
    console.error(chalk.red('Username must be 3-50 characters (letters, numbers, dot, dash, underscore).'));
    process.exitCode = 1;
    return;
  }

  const password = options.password || (await askHidden('New Password: '));
  if (password.length < 6) {
    console.error(chalk.red('Password must be at least 6 characters.'));
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await withDatabase(async (database) => {
    await ensureAdminsTable(database);

    if (database.type === 'mongodb') {
      const collection = database.collection('admin_users');
      const existing = await collection.findOne({}, { sort: { _id: 1 } });

      if (existing) {
        await collection.updateOne(
          { _id: existing._id },
          { $set: { username, password_hash: passwordHash, role: existing.role || 'admin' } }
        );
      } else {
        await collection.insertOne({
          username,
          password_hash: passwordHash,
          role: 'admin',
          created_at: new Date()
        });
      }
    } else {
      const existing = await database.query('SELECT id FROM admin_users ORDER BY id ASC LIMIT 1');

      if (existing.rows[0]) {
        await database.query('UPDATE admin_users SET username = ?, password_hash = ? WHERE id = ?', [
          username,
          passwordHash,
          existing.rows[0].id
        ]);
      } else {
        await database.query('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)', [
          username,
          passwordHash,
          'admin'
        ]);
      }
    }
  });

  console.log('');
  console.log(chalk.green(`Administrator credentials updated for "${username}".`));
}

async function statsCommand(): Promise<void> {
  const { getSystemStats } = await import('./lib/system-stats.js');
  const stats = await getSystemStats();

  printHeader('Server Statistics');

  const cpuColor = stats.cpu.usage >= 80 ? chalk.red : stats.cpu.usage >= 50 ? chalk.yellow : chalk.green;
  const memoryColor =
    stats.memory.usage >= 80 ? chalk.red : stats.memory.usage >= 50 ? chalk.yellow : chalk.green;

  console.log(`${chalk.bold('CPU Usage')}      ${cpuColor(`${stats.cpu.usage}%`)} ${chalk.gray(`(${stats.cpu.cores} cores, ${stats.cpu.speedGhz} GHz)`)}`);
  console.log(`${chalk.bold('CPU Model')}      ${stats.cpu.model}`);
  console.log(`${chalk.bold('Load Average')}   ${stats.cpu.load.join(' / ')}`);
  console.log(`${chalk.bold('RAM Usage')}      ${memoryColor(`${stats.memory.usage}%`)} ${chalk.gray(`(${stats.memory.usedLabel} / ${stats.memory.totalLabel})`)}`);
  console.log(`${chalk.bold('RAM Available')}  ${stats.memory.freeLabel}`);
  console.log(`${chalk.bold('Project Memory')} ${stats.project.rssLabel} ${chalk.gray(`(heap ${stats.project.heapLabel})`)}`);
  console.log(`${chalk.bold('Operating System')} ${stats.system.osLabel} ${chalk.gray(`(${stats.system.arch})`)}`);
  console.log(`${chalk.bold('Hostname')}       ${stats.system.hostname}`);
  console.log(`${chalk.bold('System Uptime')}  ${stats.system.uptimeLabel}`);
  console.log(`${chalk.bold('App Uptime')}     ${stats.project.uptimeLabel}`);
  console.log(`${chalk.bold('Node.js')}        ${stats.node}`);
  console.log(`${chalk.bold('Environment')}    ${process.env.NODE_ENV || 'sandbox'} / ${process.env.DB_TYPE || 'sqlite'}`);
  console.log(chalk.gray(`Updated ${stats.generatedAt}`));
}

async function serversCommand(): Promise<void> {
  const [{ listServers }, { fetchWingsServers, wingsErrorMessage }] = await Promise.all([
    import('./lib/monitor-store.js'),
    import('./lib/wings.js')
  ]);

  await withDatabase(async () => {
    const nodes = await listServers();

    printHeader('Connected Servers');

    if (nodes.length === 0) {
      console.log(chalk.yellow('No nodes configured. Add one from the List Server page.'));
      return;
    }

    let totalServers = 0;
    let totalRunning = 0;

    for (const node of nodes) {
      try {
        const nodeServers = await fetchWingsServers(node.wingsUrl, node.nodeApiKey);
        const running = nodeServers.filter((server) => server.state.toLowerCase() === 'running').length;
        totalServers += nodeServers.length;
        totalRunning += running;

        console.log('');
        console.log(
          `${chalk.bold(node.name)} ${chalk.gray(`(Node ${node.nodeId})`)} ${chalk.green('online')} ${chalk.gray(node.wingsUrl)}`
        );
        console.log(chalk.gray(`${nodeServers.length} server(s), ${running} running`));

        for (const server of nodeServers) {
          const stateColor =
            server.state.toLowerCase() === 'running'
              ? chalk.green
              : server.state.toLowerCase() === 'offline'
                ? chalk.gray
                : chalk.yellow;

          console.log(
            `  ${chalk.gray('-')} ${server.name} ${chalk.gray(`[${server.uuid}]`)} ${stateColor(server.state)} ` +
              chalk.gray(`CPU ${server.cpuAbsolute.toFixed(1)}% | RAM ${formatBytes(server.memoryBytes)} | Disk ${formatBytes(server.diskBytes)}`)
          );
        }
      } catch (error) {
        console.log('');
        console.log(
          `${chalk.bold(node.name)} ${chalk.gray(`(Node ${node.nodeId})`)} ${chalk.red('unreachable')} ${chalk.gray(node.wingsUrl)}`
        );
        console.log(chalk.red(`  ${wingsErrorMessage(error)}`));
      }
    }

    console.log('');
    console.log(chalk.gray(`Total: ${nodes.length} node(s), ${totalServers} server(s), ${totalRunning} running`));
  });
}

async function logsCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 20));
  const { listLogsPage } = await import('./lib/monitor-store.js');

  await withDatabase(async () => {
    const logs = await listLogsPage(limit, 0);

    printHeader('Recent Logs');

    if (logs.length === 0) {
      console.log(chalk.yellow('No logs recorded yet.'));
      return;
    }

    for (const log of logs) {
      const eventColor =
        log.event === 'cpu.overusage'
          ? chalk.red
          : log.event === 'memory.overusage'
            ? chalk.yellow
            : log.event === 'node.connection.restored'
              ? chalk.green
              : chalk.gray;

      console.log('');
      console.log(`${chalk.gray(log.createdAt)} ${eventColor(log.event)}`);
      console.log(
        `  ${chalk.bold(log.serverName)} ${chalk.gray(`[${log.serverId}]`)} ${chalk.gray(`Node ${log.nodeId}`)}`
      );
      console.log(`  ${log.detail}`);
    }

    console.log('');
    console.log(chalk.gray(`Showing latest ${logs.length} log(s). Use --limit <n> for more.`));
  });
}

function helpCommand(): void {
  printHeader('Pterodactyl Monitor CLI');
  console.log(`${chalk.bold('prm reset')}     Change the administrator username and password`);
  console.log(`${chalk.bold('prm stats')}     Show live CPU, RAM, project, and OS statistics`);
  console.log(`${chalk.bold('prm servers')}   Show configured nodes, connectivity, and servers`);
  console.log(`${chalk.bold('prm logs')}      Show recent monitor logs (use --limit <n>)`);
  console.log('');
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  prm reset'));
  console.log(chalk.gray('  prm reset --username admin --password secret123'));
  console.log(chalk.gray('  prm logs --limit 50'));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch ((command || 'help').toLowerCase()) {
    case 'reset':
      await resetCommand(args);
      break;
    case 'stats':
      await statsCommand();
      break;
    case 'servers':
    case 'server':
      await serversCommand();
      break;
    case 'logs':
    case 'log':
      await logsCommand(args);
      break;
    case 'help':
    case '--help':
    case '-h':
      helpCommand();
      break;
    default:
      console.error(chalk.red(`Unknown command: ${command}`));
      console.log('');
      helpCommand();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
