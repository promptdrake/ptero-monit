import { FastifyPluginAsync } from 'fastify';
import {
  addServer,
  deleteAllLogs,
  deleteLog,
  deleteServer,
  getServer,
  listLogs,
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

  fastify.get('/docker', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    const entries = await listServers();

    const nodes = await Promise.all(
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

    let totalServers = 0;
    let runningServers = 0;
    for (const node of nodes) {
      totalServers += node.servers.length;
      for (const nodeServer of node.servers) {
        if (nodeServer.state.toLowerCase() === 'running') runningServers++;
      }
    }

    return reply.view('docker.ejs', {
      admin,
      nodes,
      totals: {
        nodes: nodes.length,
        servers: totalServers,
        running: runningServers
      }
    });
  });

  fastify.get('/logs', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    return reply.view('logs.ejs', {
      admin,
      logs: await listLogs()
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

  fastify.post<{ Params: { id: string } }>('/logs/:id/delete', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    await deleteLog(request.params.id);
    return reply.redirect('/logs');
  });
};

export default serversPlugin;
