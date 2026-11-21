import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const env = (process.env.NODE_ENV || 'sandbox') as 'sandbox' | 'production';

export interface AppConfig {
  env: 'sandbox' | 'production';
  isProduction: boolean;
  isSandbox: boolean;
  port: number;
  host: string;
  dbType: string;
  [key: string]: any;
}

export const config: AppConfig = {
  ...process.env,
  env,
  isProduction: env === 'production',
  isSandbox: env === 'sandbox',
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dbType: process.env.DB_TYPE || 'sqlite'
};

export default config;
