import { FastifyPluginAsync } from 'fastify';
import { db } from '../lib/sql.js';

interface UserRecord {
  id: number | string;
  name: string;
  role: string;
}

const usersPlugin: FastifyPluginAsync = async (fastify, options) => {
//belum ditulis kodeny
// AJA SENDIRI
};

export default usersPlugin;
