import axios from 'axios';
import { wingsErrorMessage } from './wings.js';

export const DEFAULT_CUSTOM_BODY = `{
  "event": "{{event}}",
  "server_id": "{{server_id}}",
  "server_name": "{{server_name}}",
  "node_id": "{{node_id}}",
  "detail": "{{detail}}",
  "timestamp": "{{timestamp}}"
}`;

export interface WebhookEventVars {
  event: string;
  serverId: string;
  serverName: string;
  nodeId: string;
  detail: string;
  timestamp: string;
}

export function sampleWebhookVars(): WebhookEventVars {
  return {
    event: 'cpu.overusage',
    serverId: '11111111-2222-3333-4444-555555555555',
    serverName: 'Survival SMP',
    nodeId: '7',
    detail: 'CPU usage 91.2% exceeded the 80% allowance for more than 10 minute(s).',
    timestamp: new Date().toISOString()
  };
}

export function renderCustomBody(template: string, vars: WebhookEventVars): string {
  const source = template && template.trim() ? template : DEFAULT_CUSTOM_BODY;
  const values: Record<string, string> = {
    event: vars.event,
    server_id: vars.serverId,
    server_name: vars.serverName,
    node_id: vars.nodeId,
    detail: vars.detail,
    timestamp: vars.timestamp
  };

  let body = source;
  for (const key of Object.keys(values)) {
    const escaped = JSON.stringify(values[key]).slice(1, -1);
    body = body.split(`{{${key}}}`).join(escaped);
  }
  return body;
}

export function buildDiscordPayload(vars: WebhookEventVars): {
  username: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline: boolean }>;
    timestamp: string;
  }>;
} {
  const colors: Record<string, number> = {
    'cpu.overusage': 0xef4444,
    'memory.overusage': 0xf59e0b,
    'node.connection.failed': 0xf97316,
    'node.connection.restored': 0x22c55e,
    'test.notification': 0x3b82f6
  };

  return {
    username: 'Pterodactyl Monitor',
    embeds: [
      {
        title: vars.event,
        description: vars.detail || '-',
        color: colors[vars.event] ?? 0x3b82f6,
        fields: [
          { name: 'Server', value: vars.serverName || '-', inline: true },
          { name: 'Node ID', value: vars.nodeId || '-', inline: true },
          { name: 'Server ID', value: vars.serverId || '-', inline: false }
        ],
        timestamp: vars.timestamp
      }
    ]
  };
}

export function validateCustomBodyTemplate(template: string): string | null {
  const source = String(template || '').trim();
  if (!source) return null;

  try {
    JSON.parse(source);
    return null;
  } catch {
    return 'Custom webhook body must be valid JSON.';
  }
}

export async function deliverWebhook(
  url: string,
  payload: unknown,
  mode: 'discord' | 'custom'
): Promise<{ ok: boolean; message: string }> {
  try {
    const body = mode === 'custom' ? String(payload) : payload;
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    return { ok: true, message: `Delivered (HTTP ${response.status}).` };
  } catch (error) {
    return { ok: false, message: wingsErrorMessage(error) };
  }
}
