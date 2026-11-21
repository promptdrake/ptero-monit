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
import { FastifyPluginAsync } from 'fastify';
import chalk from 'chalk';
import { getMonitorSettings, listServers, addMonitorLog } from '../lib/monitor-store.js';
import { setWebhookDeliveryStatus } from '../lib/webhook-status.js';
import {
  buildDiscordPayload,
  deliverWebhook,
  renderCustomBody,
  type WebhookEventVars
} from '../lib/webhook.js';
import {
  checkWingsConnection,
  fetchWingsServers,
  wingsErrorMessage,
  type WingsServerInfo
} from '../lib/wings.js';

interface OverUsageState {
  since: number;
  logged: boolean;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

const monitorPlugin: FastifyPluginAsync = async (fastify) => {
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const overUsageState = new Map<string, OverUsageState>();
  const failingConnections = new Set<string>();

  async function sendWebhook(
    settings: Awaited<ReturnType<typeof getMonitorSettings>>,
    payload: {
      event: string;
      serverId: string;
      serverName: string;
      nodeId: string;
      detail: string;
    }
  ): Promise<void> {
    const vars: WebhookEventVars = {
      event: payload.event,
      serverId: payload.serverId,
      serverName: payload.serverName,
      nodeId: payload.nodeId,
      detail: payload.detail,
      timestamp: new Date().toISOString()
    };

    if (settings.discordEnabled && settings.discordWebhookUrl) {
      const result = await deliverWebhook(
        settings.discordWebhookUrl,
        buildDiscordPayload(vars),
        'discord'
      );

      setWebhookDeliveryStatus('discord', {
        ok: result.ok,
        event: payload.event,
        message: result.message
      });

      if (!result.ok) {
        console.warn(chalk.yellow(`[Monitor] `) + `Discord webhook delivery failed: ${result.message}`);
      }
    }

    if (settings.customEnabled && settings.customWebhookUrl) {
      const body = renderCustomBody(settings.customWebhookBody, vars);
      const result = await deliverWebhook(settings.customWebhookUrl, body, 'custom');

      setWebhookDeliveryStatus('custom', {
        ok: result.ok,
        event: payload.event,
        message: result.message
      });

      if (!result.ok) {
        console.warn(chalk.yellow(`[Monitor] `) + `Custom webhook delivery failed: ${result.message}`);
      }
    }
  }

  async function recordEvent(
    entry: { id: string; name: string; nodeId: string },
    server: WingsServerInfo | null,
    event: string,
    detail: string,
    settings: Awaited<ReturnType<typeof getMonitorSettings>>
  ): Promise<void> {
    const serverId = server?.uuid || entry.id;
    const serverName = server?.name || entry.name;

    await addMonitorLog({
      serverRowId: entry.id,
      serverId,
      serverName,
      nodeId: entry.nodeId,
      event,
      detail
    });

    console.log(
      chalk.gray(`[Monitor] `) + chalk.redBright(event) + chalk.gray(` ${serverName}: `) + detail
    );

    await sendWebhook(settings, {
      event,
      serverId,
      serverName,
      nodeId: entry.nodeId,
      detail
    });
  }

  async function inspectServer(
    entry: { id: string; name: string; nodeId: string; nodeApiKey: string; wingsUrl: string },
    settings: Awaited<ReturnType<typeof getMonitorSettings>>
  ): Promise<void> {
    const connectionKey = `${entry.id}:connection`;
    const check = await checkWingsConnection(entry.wingsUrl, entry.nodeApiKey);

    if (!check.ok) {
      if (!failingConnections.has(connectionKey)) {
        failingConnections.add(connectionKey);
        await recordEvent(entry, null, 'node.connection.failed', `Unable to reach Wings: ${check.message}`, settings);
      }
      return;
    }

    if (failingConnections.has(connectionKey)) {
      failingConnections.delete(connectionKey);
      await recordEvent(entry, null, 'node.connection.restored', 'Wings node is reachable again.', settings);
    }

    let wingsServers: WingsServerInfo[];
    try {
      wingsServers = await fetchWingsServers(entry.wingsUrl, entry.nodeApiKey);
    } catch (error) {
      if (!failingConnections.has(connectionKey)) {
        failingConnections.add(connectionKey);
        await recordEvent(
          entry,
          null,
          'node.connection.failed',
          `Unable to fetch node servers: ${wingsErrorMessage(error)}`,
          settings
        );
      }
      return;
    }

    const burstMs = Math.max(1, settings.cpuBurstMinutes) * 60 * 1000;
    const now = Date.now();

    for (const wingsServer of wingsServers) {
      const cpuKey = `${entry.id}:${wingsServer.uuid}:cpu`;
      const memoryKey = `${entry.id}:${wingsServer.uuid}:memory`;

      const cpuOver = wingsServer.cpuAbsolute > settings.allowanceUsagePercent;
      if (cpuOver) {
        const state = overUsageState.get(cpuKey);
        if (!state) {
          overUsageState.set(cpuKey, { since: now, logged: false });
        } else if (!state.logged && now - state.since >= burstMs) {
          state.logged = true;
          await recordEvent(
            entry,
            wingsServer,
            'cpu.overusage',
            `CPU usage ${wingsServer.cpuAbsolute.toFixed(1)}% exceeded the ${settings.allowanceUsagePercent}% allowance for more than ${settings.cpuBurstMinutes} minute(s).`,
            settings
          );
        }
      } else {
        overUsageState.delete(cpuKey);
      }

      const memoryPercent =
        wingsServer.memoryLimitBytes > 0
          ? (wingsServer.memoryBytes / wingsServer.memoryLimitBytes) * 100
          : 0;
      const memoryOver = memoryPercent > settings.allowanceUsagePercent;

      if (memoryOver) {
        const state = overUsageState.get(memoryKey);
        if (!state) {
          overUsageState.set(memoryKey, { since: now, logged: false });
          await recordEvent(
            entry,
            wingsServer,
            'memory.overusage',
            `Memory usage ${formatBytes(wingsServer.memoryBytes)} (${memoryPercent.toFixed(1)}%) exceeded the ${settings.allowanceUsagePercent}% allowance.`,
            settings
          );
          const created = overUsageState.get(memoryKey);
          if (created) created.logged = true;
        }
      } else {
        overUsageState.delete(memoryKey);
      }
    }
  }

  async function runCycle(): Promise<void> {
    const settings = await getMonitorSettings();
    const servers = await listServers();

    for (const entry of servers) {
      await inspectServer(entry, settings);
    }
  }

  function schedule(delayMs: number): void {
    if (stopped) return;

    timer = setTimeout(async () => {
      if (stopped) return;

      if (!running) {
        running = true;
        try {
          await runCycle();
        } catch (error) {
          console.warn(chalk.yellow(`[Monitor] `) + `Check cycle failed: ${wingsErrorMessage(error)}`);
        } finally {
          running = false;
        }
      }

      let intervalSeconds = 60;
      try {
        intervalSeconds = (await getMonitorSettings()).autoCheckInterval;
      } catch {
        intervalSeconds = 60;
      }
      schedule(Math.max(1, intervalSeconds) * 1000);
    }, delayMs);

    timer.unref?.();
  }

  fastify.addHook('onReady', async () => {
    schedule(3000);
  });

  fastify.addHook('onClose', async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  });
};

export default monitorPlugin;
