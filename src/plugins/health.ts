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

const healthPlugin: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: fastify.config.env
    };
  });
};

export default healthPlugin;
