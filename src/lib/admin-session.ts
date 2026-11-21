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
import type { FastifyRequest } from 'fastify';
import { db } from './sql.js';

export interface AdminSession {
  id: number | string;
  username: string;
  role: string;
}

export async function getSessionAdmin(request: FastifyRequest): Promise<AdminSession | null> {
  const username = request.cookies.admin_session;
  if (!username) return null;

  try {
    if (db.type === 'mongodb') {
      const doc = await db.collection('admin_users').findOne({ username });
      if (!doc) return null;
      return {
        id: String(doc._id),
        username: String(doc.username),
        role: String(doc.role || 'admin')
      };
    }

    const result = await db.query<AdminSession>(
      'SELECT id, username, role FROM admin_users WHERE username = ? LIMIT 1',
      [username]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
}
