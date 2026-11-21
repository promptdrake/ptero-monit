import os from 'os';

export interface SystemStats {
  cpu: {
    model: string;
    cores: number;
    speedGhz: number;
    usage: number;
    load: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage: number;
    totalLabel: string;
    usedLabel: string;
    freeLabel: string;
  };
  project: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    heapUsage: number;
    rssLabel: string;
    heapLabel: string;
    uptime: number;
    uptimeLabel: string;
  };
  system: {
    platform: string;
    type: string;
    release: string;
    arch: string;
    hostname: string;
    osLabel: string;
    uptime: number;
    uptimeLabel: string;
  };
  node: string;
  generatedAt: string;
}

interface CpuSample {
  idle: number;
  total: number;
}

const CACHE_TTL_MS = 2500;
const CPU_SAMPLE_MS = 200;

let cache: { expiresAt: number; value: SystemStats } | null = null;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ${hours} hour${hours === 1 ? '' : 's'}`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ${secs} second${secs === 1 ? '' : 's'}`;
  return `${secs} second${secs === 1 ? '' : 's'}`;
}

function platformName(platform: string): string {
  switch (platform) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'freebsd':
      return 'FreeBSD';
    case 'openbsd':
      return 'OpenBSD';
    case 'aix':
      return 'AIX';
    case 'sunos':
      return 'SunOS';
    default:
      return platform;
  }
}

function takeCpuSample(): CpuSample[] {
  return os.cpus().map((cpu) => {
    const times = cpu.times;
    return {
      idle: times.idle,
      total: times.user + times.nice + times.sys + times.irq + times.idle
    };
  });
}

async function measureCpuUsage(): Promise<number> {
  const start = takeCpuSample();
  await new Promise((resolve) => setTimeout(resolve, CPU_SAMPLE_MS));
  const end = takeCpuSample();

  let idleDelta = 0;
  let totalDelta = 0;

  for (let index = 0; index < end.length && index < start.length; index++) {
    idleDelta += Math.max(0, end[index].idle - start[index].idle);
    totalDelta += Math.max(0, end[index].total - start[index].total);
  }

  if (totalDelta <= 0) return 0;

  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.round(Math.min(100, Math.max(0, usage)));
}

function buildStats(cpuUsage: number): SystemStats {
  const cpus = os.cpus();
  const firstCpu = cpus[0];
  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  const memoryUsed = memoryTotal - memoryFree;
  const processMemory = process.memoryUsage();
  const platform = os.platform();
  const release = os.release();

  return {
    cpu: {
      model: firstCpu?.model?.trim() || 'Unknown CPU',
      cores: cpus.length || 1,
      speedGhz: firstCpu?.speed ? Math.round((firstCpu.speed / 1000) * 10) / 10 : 0,
      usage: cpuUsage,
      load: os.loadavg().map((value) => Math.round(value * 100) / 100)
    },
    memory: {
      total: memoryTotal,
      used: memoryUsed,
      free: memoryFree,
      usage: memoryTotal > 0 ? Math.round((memoryUsed / memoryTotal) * 100) : 0,
      totalLabel: formatBytes(memoryTotal),
      usedLabel: formatBytes(memoryUsed),
      freeLabel: formatBytes(memoryFree)
    },
    project: {
      rss: processMemory.rss,
      heapUsed: processMemory.heapUsed,
      heapTotal: processMemory.heapTotal,
      heapUsage: processMemory.heapTotal > 0 ? Math.round((processMemory.heapUsed / processMemory.heapTotal) * 100) : 0,
      rssLabel: formatBytes(processMemory.rss),
      heapLabel: `${formatBytes(processMemory.heapUsed)} / ${formatBytes(processMemory.heapTotal)}`,
      uptime: process.uptime(),
      uptimeLabel: formatDuration(process.uptime())
    },
    system: {
      platform,
      type: os.type(),
      release,
      arch: os.arch(),
      hostname: os.hostname(),
      osLabel: `${platformName(platform)} ${release}`,
      uptime: os.uptime(),
      uptimeLabel: formatDuration(os.uptime())
    },
    node: process.version,
    generatedAt: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' })
  };
}

export async function getSystemStats(): Promise<SystemStats> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  const cpuUsage = await measureCpuUsage();
  const value = buildStats(cpuUsage);
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, value };
  return value;
}
