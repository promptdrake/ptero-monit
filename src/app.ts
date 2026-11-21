import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import Fastify, { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import chalk from 'chalk';
import { config, AppConfig } from './config/env.js';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    env: AppConfig;
  }
  interface FastifyRequest {
    config: AppConfig;
    env: AppConfig;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatStatus(status: number): string {
  if (status >= 500) return chalk.red.bold(status);
  if (status >= 400) return chalk.yellow.bold(status);
  if (status >= 300) return chalk.cyan.bold(status);
  return chalk.green.bold(status);
}

function formatMethod(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return chalk.blue.bold(method.padEnd(6));
    case 'POST':
      return chalk.green.bold(method.padEnd(6));
    case 'PUT':
      return chalk.yellow.bold(method.padEnd(6));
    case 'DELETE':
      return chalk.red.bold(method.padEnd(6));
    case 'PATCH':
      return chalk.magenta.bold(method.padEnd(6));
    default:
      return chalk.white.bold(method.padEnd(6));
  }
}

/**
 * Global environment plugin
 */
const envPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('config', config);
  app.decorate('env', config);
  app.decorateRequest('config', { getter: () => config });
  app.decorateRequest('env', { getter: () => config });
});


async function loadPlugins(app: FastifyInstance): Promise<void> {
  const pluginsDir = path.join(__dirname, 'plugins');

  if (!fs.existsSync(pluginsDir)) return;

  const files = fs.readdirSync(pluginsDir);

  for (const file of files) {
    if ((file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts')) {
      const pluginPath = path.join(pluginsDir, file);
      const pluginModule = await import(pathToFileURL(pluginPath).href);
      const plugin = pluginModule.default || pluginModule;
      await app.register(plugin);
      console.log(chalk.gray(`[Plugin] `) + chalk.greenBright(`✓ Loaded ${file}`));
    }
  }
}

function resolveResourceDir(name: 'views' | 'assets'): string {
  const runtimeDir = path.join(__dirname, name);
  if (fs.existsSync(runtimeDir)) return runtimeDir;

  const sourceDir = path.resolve(__dirname, '..', 'src', name);
  if (fs.existsSync(sourceDir)) return sourceDir;

  fs.mkdirSync(runtimeDir, { recursive: true });
  return runtimeDir;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false
  });

  await app.register(envPlugin);
  await app.register(fastifyFormbody);
  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'ptero-secret-key-321'
  });

  const viewsDir = resolveResourceDir('views');
  await app.register(fastifyView, {
    engine: {
      ejs
    },
    root: viewsDir
  });

  const assetsDir = resolveResourceDir('assets');
  await app.register(fastifyStatic, {
    root: assetsDir,
    prefix: '/assets/'
  });
  app.addHook('onResponse', async (request, reply) => {
    const time = new Date().toLocaleTimeString();
    const ip = request.headers['x-forwarded-for'] || request.ip || '127.0.0.1';
    const method = formatMethod(request.method);
    const url = chalk.white(request.url);
    const status = formatStatus(reply.statusCode);
    const responseTime = chalk.yellow(`${reply.elapsedTime.toFixed(1)}ms`);

    console.log(
      `${chalk.gray(`[${time}]`)} ${chalk.dim(`(${ip})`)} ${method} ${url} ${status} ${responseTime}`
    );
  });

  await loadPlugins(app);

  return app;
}

export { config };
export default buildApp;
