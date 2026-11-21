# Fastify TypeScript Backend Starter (ESM)

Starter backend built with **Fastify**, **TypeScript (ESM / NodeNext)**, **Unified Multi-Database layer (PostgreSQL, SQLite, MySQL, MongoDB)**, and dynamic plugin autoloading.

---

## ⚙️ 4 Databases in a Single `.env`

Control which database is active using `DB_TYPE` inside [`.env`](file:///D:/asjfw/pterooverloadchecker/.env):

```env
# Active Database: mysql | postgresql | sqlite | mongodb
DB_TYPE=sqlite

# 1. MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=pterooverload

# 2. PostgreSQL
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=
PG_DATABASE=pterooverload

# 3. SQLite
SQLITE_FILE=data/app.db

# 4. MongoDB
MONGO_URI=mongodb://localhost:27017
MONGO_DATABASE=pterooverload
```

---

## 🗄️ One Codebase Across All Databases (`src/lib/sql.ts`)

You don't need to rewrite queries when switching databases. The unified client automatically handles SQL parameter binding across **MySQL**, **PostgreSQL**, and **SQLite**:

```typescript
import { db } from '../lib/sql.js';

// Unified query across MySQL, PostgreSQL, SQLite:
const result = await db.query('SELECT * FROM users WHERE role = ?', ['admin']);
console.log(result.rows);

// Unified insert:
const insert = await db.query('INSERT INTO users (name, role) VALUES (?, ?)', ['Alice', 'admin']);
console.log(insert.insertId);

// For MongoDB:
const docs = await db.collection('users').find({}).toArray();

// Or access native instances if needed:
// db.mysqlPool
// db.pgPool
// db.sqliteDb
// db.mongoDb
```

---

## 🔌 Adding New Endpoints (Plugin System)

Just create a `.ts` file inside [`src/plugins/`](file:///D:/asjfw/pterooverloadchecker/src/plugins/). Fastify automatically registers it.

```typescript
import { FastifyPluginAsync } from 'fastify';
import { db } from '../lib/sql.js';

const examplePlugin: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/status', async () => {
    return await db.testConnection();
  });
};

export default examplePlugin;
```

---

## 🚀 Running the Server

```bash
# Start in development mode (hot reload)
npm run dev

# Build
npm run build

# Start production build
npm start
```
