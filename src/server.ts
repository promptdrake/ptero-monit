import chalk from 'chalk';
import { buildApp, config } from './app.js';

async function start() {
  try {
    const app = await buildApp();
    await app.listen({ port: config.port, host: config.host });

    const envColor = config.isProduction ? chalk.red.bold : chalk.cyan.bold;

    console.log(`\n${chalk.green.bold('🚀 Pterodactyl Resource Monitoring is Running!')}`);
    console.log(`${chalk.gray('• URL        :')} ${chalk.underline.bold(`http://${config.host}:${config.port}`)}`);
    console.log(`${chalk.gray('• Environment:')} ${envColor(config.env.toUpperCase())}\n`);
  } catch (err) {
    console.error(chalk.red.bold('Error starting server:'), err);
    process.exit(1);
  }
}

start();
