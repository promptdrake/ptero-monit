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
import axios from 'axios';

export interface WingsSystemInfo {
  version: string;
  cpuThreads: number;
  memoryBytes: number;
  os: string;
  architecture: string;
  kernelVersion: string;
}

export interface WingsServerInfo {
  uuid: string;
  name: string;
  state: string;
  cpuAbsolute: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
}

export interface WingsCheckResult {
  ok: boolean;
  message: string;
  system?: WingsSystemInfo;
}

export function normalizeWingsUrl(input: string): string {
  let url = String(input || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

function authHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${String(apiKey || '').trim()}`,
    Accept: 'application/json'
  };
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      const data = error.response.data as any;
      const detail = data?.error || data?.message || error.response.statusText;
      return `HTTP ${error.response.status}${detail ? `: ${detail}` : ''}`;
    }
    if (error.code === 'ECONNREFUSED') return 'Connection refused';
    if (error.code === 'ENOTFOUND') return 'Host not found';
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') return 'Connection timed out';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function checkWingsConnection(wingsUrl: string, apiKey: string): Promise<WingsCheckResult> {
  const baseUrl = normalizeWingsUrl(wingsUrl);

  if (!baseUrl) {
    return { ok: false, message: 'Wings URL is required.' };
  }
  if (!String(apiKey || '').trim()) {
    return { ok: false, message: 'Node API key is required.' };
  }

  try {
    const response = await axios.get(`${baseUrl}/api/system`, {
      params: { v: 2 },
      headers: authHeaders(apiKey),
      timeout: 10000
    });

    const data = response.data || {};
    const system: WingsSystemInfo = {
      version: String(data.version || ''),
      cpuThreads: Number(data.system?.cpu_threads) || 0,
      memoryBytes: Number(data.system?.memory_bytes) || 0,
      os: String(data.system?.os || ''),
      architecture: String(data.system?.architecture || ''),
      kernelVersion: String(data.system?.kernel_version || '')
    };

    return {
      ok: true,
      message: `Connected to Wings${system.version ? ` v${system.version}` : ''}${system.os ? ` on ${system.os}` : ''}.`,
      system
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function fetchWingsServers(wingsUrl: string, apiKey: string): Promise<WingsServerInfo[]> {
  const baseUrl = normalizeWingsUrl(wingsUrl);
  if (!baseUrl) return [];

  const response = await axios.get(`${baseUrl}/api/servers`, {
    headers: authHeaders(apiKey),
    timeout: 10000
  });

  if (!Array.isArray(response.data)) return [];

  return response.data
    .map((item: any): WingsServerInfo | null => {
      const uuid = String(item?.configuration?.uuid || '').trim();
      if (!uuid) return null;
      return {
        uuid,
        name: String(item?.configuration?.meta?.name || uuid),
        state: String(item?.state || 'unknown'),
        cpuAbsolute: Number(item?.utilization?.cpu_absolute) || 0,
        memoryBytes: Number(item?.utilization?.memory_bytes) || 0,
        memoryLimitBytes: Number(item?.utilization?.memory_limit_bytes) || 0,
        diskBytes: Number(item?.utilization?.disk_bytes) || 0
      };
    })
    .filter((item): item is WingsServerInfo => item !== null);
}

export { errorMessage as wingsErrorMessage };
