import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../lib/sql.js';
import { getSystemStats } from '../lib/system-stats.js';
import { getAppSettings, saveAppSettings } from '../lib/settings.js';
import { getWebhookDeliveryStatus, setWebhookDeliveryStatus } from '../lib/webhook-status.js';
import {
  buildDiscordPayload,
  deliverWebhook,
  renderCustomBody,
  sampleWebhookVars,
  validateCustomBodyTemplate
} from '../lib/webhook.js';

interface AdminAccount {
  id: number | string;
  username: string;
  password_hash: string;
  role: string;
  created_at?: string;
}

/**
 * Auth & Admin Plugin (Rendered using EJS at src/views)
 */
const authPlugin: FastifyPluginAsync = async (fastify, options) => {
  // Ensure admins table exists across databases
  try {
    if (db.type === 'sqlite' || db.type === 'mysql') {
      await db.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else if (db.type === 'postgresql') {
      await db.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'admin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
  } catch (err: any) {
    fastify.log.warn?.(`Admin table init note (${db.type}): ${err.message}`);
  }

  // Count existing admin accounts
  async function getAdminCount(): Promise<number> {
    try {
      if (db.type === 'mongodb') {
        return await db.collection('admin_users').countDocuments();
      }
      const res = await db.query('SELECT COUNT(*) as cnt FROM admin_users');
      const count = res.rows[0]?.cnt ?? res.rows[0]?.count ?? 0;
      return Number(count);
    } catch {
      return 0;
    }
  }

  // Find admin by username
  async function findAdmin(username: string): Promise<AdminAccount | null> {
    if (db.type === 'mongodb') {
      const doc = await db.collection('admin_users').findOne({ username });
      if (!doc) return null;
      return {
        id: String(doc._id),
        username: doc.username,
        password_hash: doc.password_hash,
        role: doc.role || 'admin'
      };
    }
    const res = await db.query<AdminAccount>(
      'SELECT id, username, password_hash, role FROM admin_users WHERE username = ? LIMIT 1',
      [username]
    );
    return res.rows[0] || null;
  }

  // Resolve the admin account for the current session cookie
  async function getSessionAdmin(request: FastifyRequest): Promise<AdminAccount | null> {
    const username = request.cookies.admin_session;
    if (!username) return null;
    return findAdmin(username);
  }

  // --- 1. GET / (First Visit) ---
  fastify.get('/', async (request, reply) => {
    // If already logged in, redirect directly to admin dashboard
    const session = request.cookies.admin_session;
    if (session) {
      const admin = await findAdmin(session);
      if (admin) {
        return reply.redirect('/admin');
      }
    }

    // Check if admin exists
    const adminCount = await getAdminCount();
    if (adminCount === 0) {
      // Pointed to create initial admin account
      return reply.redirect('/setup-admin');
    }

    // Render login page using EJS
    return reply.view('login.ejs', {
      env: fastify.env.env,
      dbType: fastify.env.dbType,
      error: null
    });
  });

  // --- 2. GET /setup-admin ---
  fastify.get('/setup-admin', async (request, reply) => {
    const adminCount = await getAdminCount();
    if (adminCount > 0) {
      return reply.redirect('/');
    }

    return reply.view('setup-admin.ejs', {
      env: fastify.env.env,
      dbType: fastify.env.dbType,
      error: null
    });
  });

  // --- 3. POST /setup-admin ---
  fastify.post<{ Body: { username?: string; password?: string; confirm_password?: string } }>(
    '/setup-admin',
    async (request, reply) => {
      const adminCount = await getAdminCount();
      if (adminCount > 0) {
        return reply.redirect('/');
      }

      const { username, password, confirm_password } = request.body || {};

      if (!username || !password) {
        return reply.view('setup-admin.ejs', {
          env: fastify.env.env,
          dbType: fastify.env.dbType,
          error: 'Username and password are required.'
        });
      }

      if (password !== confirm_password) {
        return reply.view('setup-admin.ejs', {
          env: fastify.env.env,
          dbType: fastify.env.dbType,
          error: 'Passwords do not match.'
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      if (db.type === 'mongodb') {
        await db.collection('admin_users').insertOne({
          username: username.trim(),
          password_hash: passwordHash,
          role: 'admin',
          created_at: new Date()
        });
      } else {
        await db.query(
          'INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)',
          [username.trim(), passwordHash, 'admin']
        );
      }

      reply.setCookie('admin_session', username.trim(), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 86400 * 7
      });

      return reply.redirect('/admin');
    }
  );

  // --- 4. POST /login ---
  fastify.post<{ Body: { username?: string; password?: string } }>('/login', async (request, reply) => {
    const { username, password } = request.body || {};

    if (!username || !password) {
      return reply.view('login.ejs', {
        env: fastify.env.env,
        dbType: fastify.env.dbType,
        error: 'Username and password are required.'
      });
    }

    const admin = await findAdmin(username.trim());
    if (!admin) {
      return reply.view('login.ejs', {
        env: fastify.env.env,
        dbType: fastify.env.dbType,
        error: 'Invalid username or password.'
      });
    }

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      return reply.view('login.ejs', {
        env: fastify.env.env,
        dbType: fastify.env.dbType,
        error: 'Invalid username or password.'
      });
    }

    reply.setCookie('admin_session', admin.username, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 86400 * 7
    });

    return reply.redirect('/admin');
  });

  // --- 5. GET /admin ---
  fastify.get('/admin', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    return reply.view('admin.ejs', {
      admin,
      stats: await getSystemStats(),
      env: fastify.env.env,
      dbType: fastify.env.dbType,
      port: fastify.env.port,
      uptime: Math.floor(process.uptime())
    });
  });

  // --- 6. GET /settings ---
  fastify.get<{ Querystring: { saved?: string } }>('/settings', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    const settings = await getAppSettings();

    return reply.view('settings.ejs', {
      admin,
      panelUrl: settings.panelUrl,
      ptlcApiKey: settings.ptlcApiKey,
      ptlaApiKey: settings.ptlaApiKey,
      discordEnabled: settings.discordEnabled,
      discordWebhookUrl: settings.discordWebhookUrl,
      customEnabled: settings.customEnabled,
      customWebhookUrl: settings.customWebhookUrl,
      customWebhookBody: settings.customWebhookBody,
      autoCheckInterval: settings.autoCheckInterval,
      allowanceUsagePercent: settings.allowanceUsagePercent,
      cpuBurstMinutes: settings.cpuBurstMinutes,
      discordStatus: getWebhookDeliveryStatus('discord'),
      customStatus: getWebhookDeliveryStatus('custom'),
      error: null,
      saved: request.query.saved === '1'
    });
  });

  // --- 7. POST /settings ---
  fastify.post<{
    Body: {
      panel_url?: string;
      ptlc_api_key?: string;
      ptla_api_key?: string;
      discord_enabled?: string;
      discord_webhook_url?: string;
      custom_enabled?: string;
      custom_webhook_url?: string;
      custom_webhook_body?: string;
      auto_check_interval?: string;
      allowance_usage?: string;
      cpu_burst_minutes?: string;
    };
  }>('/settings', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      reply.clearCookie('admin_session', { path: '/' });
      return reply.redirect('/');
    }

    const body = request.body || {};
    const panelUrl = String(body.panel_url || '').trim();
    const ptlcApiKey = String(body.ptlc_api_key || '').trim();
    const ptlaApiKey = String(body.ptla_api_key || '').trim();
    const discordEnabled =
      body.discord_enabled === 'on' || body.discord_enabled === 'true' || body.discord_enabled === '1';
    const discordWebhookUrl = String(body.discord_webhook_url || '').trim();
    const customEnabled =
      body.custom_enabled === 'on' || body.custom_enabled === 'true' || body.custom_enabled === '1';
    const customWebhookUrl = String(body.custom_webhook_url || '').trim();
    const customWebhookBody = String(body.custom_webhook_body || '').trim();
    const intervalRaw = String(body.auto_check_interval || '').trim();
    const allowanceRaw = String(body.allowance_usage || '').trim();
    const burstRaw = String(body.cpu_burst_minutes || '').trim();
    const interval = Number(intervalRaw);
    const allowance = Number(allowanceRaw);
    const burst = Number(burstRaw);

    let error: string | null = null;

    if (!intervalRaw || !Number.isFinite(interval) || interval < 1) {
      error = 'Auto Check Interval is required and must be at least 1 second.';
    } else if (!allowanceRaw || !Number.isFinite(allowance) || allowance < 1 || allowance > 100) {
      error = 'Allowance Usage must be between 1 and 100 percent.';
    } else if (!burstRaw || !Number.isFinite(burst) || burst < 1) {
      error = 'CPU Burst Time Allowance is required and must be at least 1 minute.';
    } else if (discordEnabled && !discordWebhookUrl) {
      error = 'Discord webhook link is required when the Discord webhook is enabled.';
    } else if (customEnabled && !customWebhookUrl) {
      error = 'Custom webhook URL is required when the custom webhook is enabled.';
    } else if (customEnabled) {
      error = validateCustomBodyTemplate(customWebhookBody);
    }

    if (error) {
      return reply.view('settings.ejs', {
        admin,
        panelUrl,
        ptlcApiKey,
        ptlaApiKey,
        discordEnabled,
        discordWebhookUrl,
        customEnabled,
        customWebhookUrl,
        customWebhookBody,
        autoCheckInterval: intervalRaw,
        allowanceUsagePercent: allowanceRaw,
        cpuBurstMinutes: burstRaw,
        discordStatus: getWebhookDeliveryStatus('discord'),
        customStatus: getWebhookDeliveryStatus('custom'),
        error,
        saved: false
      });
    }

    await saveAppSettings({
      panelUrl,
      ptlcApiKey,
      ptlaApiKey,
      discordEnabled,
      discordWebhookUrl,
      customEnabled,
      customWebhookUrl,
      customWebhookBody,
      autoCheckInterval: interval,
      allowanceUsagePercent: allowance,
      cpuBurstMinutes: burst
    });

    return reply.redirect('/settings?saved=1');
  });

  // --- 8. POST /settings/test-webhook ---
  fastify.post<{
    Body: {
      target?: string;
      discord_webhook_url?: string;
      custom_webhook_url?: string;
      custom_webhook_body?: string;
    };
  }>('/settings/test-webhook', async (request, reply) => {
    const admin = await getSessionAdmin(request);
    if (!admin) {
      return reply.code(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const body = request.body || {};
    const vars = sampleWebhookVars();

    if (body.target === 'discord') {
      const url = String(body.discord_webhook_url || '').trim();
      if (!url) {
        return reply.send({ ok: false, message: 'Discord webhook link is required.' });
      }

      const result = await deliverWebhook(url, buildDiscordPayload(vars), 'discord');
      setWebhookDeliveryStatus('discord', {
        ok: result.ok,
        event: 'test.notification',
        message: result.message
      });
      return reply.send(result);
    }

    if (body.target === 'custom') {
      const url = String(body.custom_webhook_url || '').trim();
      if (!url) {
        return reply.send({ ok: false, message: 'Custom webhook URL is required.' });
      }

      const template = String(body.custom_webhook_body || '').trim();
      const validation = validateCustomBodyTemplate(template);
      if (validation) {
        return reply.send({ ok: false, message: validation });
      }

      const result = await deliverWebhook(url, renderCustomBody(template, vars), 'custom');
      setWebhookDeliveryStatus('custom', {
        ok: result.ok,
        event: 'test.notification',
        message: result.message
      });
      return reply.send(result);
    }

    return reply.send({ ok: false, message: 'Unknown webhook target.' });
  });

  // --- 9. GET /logout ---
  fastify.get('/logout', async (request, reply) => {
    reply.clearCookie('admin_session', { path: '/' });
    return reply.redirect('/');
  });
};

export default authPlugin;
