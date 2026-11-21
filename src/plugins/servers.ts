import { FastifyPluginAsync } from 'fastify';
import {
  addServer,
  countLogs,
  deleteAllLogs,
  deleteLog,
  deleteServer,
  getServer,
  listLogsPage,
  listServers
} from '../lib/monitor-store.js';
import { getSessionAdmin } from '../lib/admin-session.js';
import { checkWingsConnection, fetchWingsServers, normalizeWingsUrl, wingsErrorMessage } from '../lib/wings.js';
import { getAppSettings } from '../lib/settings.js';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function stateTheme(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === 'running') return 'theme-success';
  if (normalized === 'starting' || normalized === 'stopping' || normalized === 'restarting') return 'theme-warning';
  if (normalized === 'installing' || normalized === 'transferring') return 'theme-info';
  if (normalized === 'suspended') return 'theme-danger';
  return 'theme-secondary';
}

interface DockerNodeServer {
  uuid: string;
  name: string;
  state: string;
  stateTheme: string;
  cpuLabel: string;
  memoryLabel: string;
  memoryPercent: number;
  diskLabel: string;
}

interface DockerNodeResult {
  id: string;
  name: string;
  nodeId: string;
  wingsUrl: string;
  ok: boolean;
  message: string;
  servers: DockerNodeServer[];
}

interface ServerFormBody {
  name?: string;
  node_id?: string;
  node_api_key?: string;
  wings_url?: string;
}

const serversPlugin: FastifyPluginAsync = async (fastify) => {
  function readForm(body: ServerFormBody) {
    return {
      name: String(body.name || '').trim(),
      nodeId: String(body.node_id || '').trim(),
      nodeApiKey: String(body.node_api_key || '').trim(),
      wingsUrl: normalizeWingsUrl(String(body.wings_url || ''))
    };
  }

  fastify.get('/servers', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    return reply.view('servers.ejs', {
      admin,
      servers: await listServers(),
      autoCheckInterval: (await getAppSettings()).autoCheckInterval,
      form: { name: '', nodeId: '', nodeApiKey: '', wingsUrl: '' },
      error: null,
      testResult: null
    });
  });

  fastify.post<{ Body: ServerFormBody }>('/servers', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    const form = readForm(request.body || {});
    const missing: string[] = [];

    if (!form.name) missing.push('Server Name');
    if (!form.nodeId) missing.push('Node ID');
    if (!form.nodeApiKey) missing.push('Node API Key');
    if (!form.wingsUrl) missing.push('Wings URL');

    if (missing.length > 0) {
      return reply.view('servers.ejs', {
        admin,
        servers: await listServers(),
        autoCheckInterval: (await getAppSettings()).autoCheckInterval,
        form,
        error: `Please fill in: ${missing.join(', ')}.`,
        testResult: null
      });
    }

    await addServer(form);
    return reply.redirect('/servers');
  });

  fastify.post<{ Body: ServerFormBody }>('/servers/test', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      return reply.code(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const form = readForm(request.body || {});
    if (!form.wingsUrl) {
      return reply.send({ ok: false, message: 'Wings URL is required.' });
    }
    if (!form.nodeApiKey) {
      return reply.send({ ok: false, message: 'Node API Key is required.' });
    }

    const result = await checkWingsConnection(form.wingsUrl, form.nodeApiKey);
    return reply.send(result);
  });

  fastify.get<{ Params: { id: string } }>('/servers/:id/check', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    const server = await getServer(request.params.id);
    if (!server) {
      return reply.redirect('/servers');
    }

    const result = await checkWingsConnection(server.wingsUrl, server.nodeApiKey);

    return reply.view('servers.ejs', {
      admin,
      servers: await listServers(),
      autoCheckInterval: (await getAppSettings()).autoCheckInterval,
      form: { name: '', nodeId: '', nodeApiKey: '', wingsUrl: '' },
      error: null,
      testResult: {
        serverName: server.name,
        ok: result.ok,
        message: result.message
      }
    });
  });

  fastify.post<{ Params: { id: string } }>('/servers/:id/delete', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    await deleteServer(request.params.id);
    return reply.redirect('/servers');
  });

  fastify.get<{ Querystring: { q?: string; status?: string; page?: string } }>(
    '/docker',
    async (request, reply) => {
      const admin = await getSessionAdmin(request);
      if (!admin) {
        reply.clearCookie('admin_session', { path: '/' });
        return reply.redirect('/');
      }

      const pageSize = 10;
      const search = String(request.query.q || '').trim();
      const status = String(request.query.status || '').trim().toLowerCase();
      const entries = await listServers();

      const nodes: DockerNodeResult[] = await Promise.all(
        entries.map(async (entry) => {
          try {
            const nodeServers = await fetchWingsServers(entry.wingsUrl, entry.nodeApiKey);
            return {
              id: entry.id,
              name: entry.name,
              nodeId: entry.nodeId,
              wingsUrl: entry.wingsUrl,
              ok: true,
              message: '',
              servers: nodeServers.map((server) => ({
                uuid: server.uuid,
                name: server.name,
                state: server.state,
                stateTheme: stateTheme(server.state),
                cpuLabel: `${server.cpuAbsolute.toFixed(1)}%`,
                memoryLabel: `${formatBytes(server.memoryBytes)} / ${
                  server.memoryLimitBytes > 0 ? formatBytes(server.memoryLimitBytes) : 'Unlimited'
                }`,
                memoryPercent:
                  server.memoryLimitBytes > 0
                    ? Math.round((server.memoryBytes / server.memoryLimitBytes) * 100)
                    : 0,
                diskLabel: formatBytes(server.diskBytes)
              }))
            };
          } catch (error) {
            return {
              id: entry.id,
              name: entry.name,
              nodeId: entry.nodeId,
              wingsUrl: entry.wingsUrl,
              ok: false,
              message: wingsErrorMessage(error),
              servers: []
            };
          }
        })
      );

      const allRows = nodes.flatMap((node) =>
        node.servers.map((nodeServer) => ({
          ...nodeServer,
          nodeName: node.name,
          nodeId: node.nodeId
        }))
      );

      const lowered = search.toLowerCase();
      const filteredRows = allRows.filter((row) => {
        const matchesSearch =
          !lowered ||
          [row.name, row.uuid, row.nodeName, row.nodeId].some((value) =>
            value.toLowerCase().includes(lowered)
          );
        const matchesStatus = !status || row.state.toLowerCase() === status;
        return matchesSearch && matchesStatus;
      });

      const statuses = Array.from(new Set(allRows.map((row) => row.state.toLowerCase()))).sort();
      const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
      const currentPage = Math.min(Math.max(1, Number(request.query.page) || 1), totalPages);
      const rows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

      const unreachable = nodes
        .filter((node) => !node.ok)
        .filter(
          (node) =>
            !lowered ||
            [node.name, node.nodeId, node.wingsUrl].some((value) =>
              value.toLowerCase().includes(lowered)
            )
        )
        .map((node) => ({
          name: node.name,
          nodeId: node.nodeId,
          wingsUrl: node.wingsUrl,
          message: node.message
        }));

      return reply.view('docker.ejs', {
        admin,
        totals: {
          nodes: nodes.length,
          servers: allRows.length,
          running: allRows.filter((row) => row.state.toLowerCase() === 'running').length
        },
        rows,
        statuses,
        filters: { q: search, status },
        pagination: { currentPage, totalPages },
        totalFiltered: filteredRows.length,
        unreachable
      });
    }
  );

  fastify.get<{ Querystring: { page?: string } }>('/logs', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    const pageSize = 10;
    const total = await countLogs();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(Math.max(1, Number(request.query.page) || 1), totalPages);
    const logs = await listLogsPage(pageSize, (currentPage - 1) * pageSize);

    return reply.view('logs.ejs', {
      admin,
      logs,
      pagination: { currentPage, totalPages },
      totalLogs: total
    });
  });

  fastify.post('/logs/delete-all', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    await deleteAllLogs();
    return reply.redirect('/logs');
  });

  fastify.post<{ Params: { id: string }; Querystring: { page?: string } }>(
    '/logs/:id/delete',
    async (request, reply) => {
      const admin = await getSessionAdmin(request);
      if (!admin) {
        reply.clearCookie('admin_session', { path: '/' });
        return reply.redirect('/');
      }

      await deleteLog(request.params.id);
      const page = Math.max(1, Number(request.query.page) || 1);
      return reply.redirect(`/logs?page=${page}`);
    }
  );
};

export default serversPlugin;
