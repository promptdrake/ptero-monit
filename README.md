<p align="center">
  <img src="src/assets/logo.png" width="110" alt="Pterodactyl Server Monitor logo">
</p>

<h1 align="center">Pterodactyl Server Monitor</h1>

<p align="center">
  A lightweight dashboard for monitoring Pterodactyl Wings nodes, server usage, Docker containers, and webhook notifications.
</p>

---

## Features

- **Dashboard** — live CPU, RAM, project memory, operating system, and uptime statistics.
- **List Server** — register Wings nodes, test connections with the node daemon token, and remove entries.
- **Docker** — lists every server reported by each Wings node with status, CPU, memory, and disk usage, plus search/status filters and pagination.
- **Automatic monitoring** — checks nodes on the configured interval, tracks CPU and memory allowance usage, respects the CPU burst allowance, and records events.
- **Log** — paginated event history with per-entry delete and delete-all.
- **Webhooks** — one Discord embed webhook and one custom JSON webhook, each with its own toggle and test button.
- **Authentication** — first-run administrator setup, session login, and password reset from the CLI.
- **Databases** — SQLite, MySQL, PostgreSQL, and MongoDB.

## Requirements

- Node.js 22 or newer
- A Pterodactyl Wings node with its daemon token
- One supported database

## Installation

```bash
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
```

Open `http://localhost:3000`. On the first launch you will be asked to create the administrator account.

## Configuration

Create a `.env` file in the project root. SQLite is used by default.

```env
NODE_ENV=sandbox
HOST=0.0.0.0
PORT=3000
COOKIE_SECRET=change-this-secret

DB_TYPE=sqlite
SQLITE_FILE=data/app.db
```

Required variables for other databases:

| Database | Variables |
| --- | --- |
| MySQL | `DB_TYPE=mysql`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` |
| PostgreSQL | `DB_TYPE=postgresql`, `PG_URL` or `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` |
| MongoDB | `DB_TYPE=mongodb`, `MONGO_URI`, `MONGO_DATABASE` |

## Settings

The Settings page contains:

- **Panel** — Panel URL, PTLC API key, and PTLA API key.
- **Monitoring** — Auto Check Interval (seconds), Allowance Usage (percent), and CPU Burst Time Allowance (minutes).
- **Discord Webhook** — enable, Discord webhook link, and a test notification button.
- **Custom Webhook** — enable, URL, editable JSON body, and a test notification button.
- **Webhook Delivery** — last delivery status for each webhook.
- **Event Types** — event documentation and JSON payload examples.

## CLI

The `prm` command is available from the project directory. It is defined as a package `bin`, so `npm link` once to run it as `prm` from anywhere. On Windows you can also use `.\prm`.

```bash
prm reset                              # Prompt for a new username and password
prm reset --username admin --password secret123
prm stats                              # CPU, RAM, project, OS, and uptime statistics
prm servers                            # Nodes, connectivity, servers, and live usage
prm logs                               # Recent monitor logs
prm logs --limit 50
prm help
```

`prm reset` updates the existing administrator account, or creates one when no administrator exists.

## Webhook Events

Webhook delivery requires the matching webhook toggle to be on and its URL to be saved. Both webhooks receive the same event; Discord receives an embed and the custom webhook receives the body defined in Settings.

| Event | Sent when |
| --- | --- |
| `cpu.overusage` | CPU usage stays above Allowance Usage for longer than CPU Burst Time Allowance. |
| `memory.overusage` | Server memory usage rises above Allowance Usage. |
| `node.connection.failed` | A Wings node cannot be reached or its server list cannot be fetched. |
| `node.connection.restored` | A node that previously failed becomes reachable again. |

### Discord Embed Payload

```json
{
  "username": "Pterodactyl Monitor",
  "embeds": [
    {
      "title": "cpu.overusage",
      "description": "CPU usage 91.2% exceeded the 80% allowance for more than 10 minute(s).",
      "color": 15680580,
      "fields": [
        { "name": "Server", "value": "Survival SMP", "inline": true },
        { "name": "Node ID", "value": "7", "inline": true },
        { "name": "Server ID", "value": "11111111-2222-3333-4444-555555555555", "inline": false }
      ],
      "timestamp": "2026-11-21T15:31:06.000Z"
    }
  ]
}
```

### Custom Webhook Payload

Default template:

```json
{
  "event": "{{event}}",
  "server_id": "{{server_id}}",
  "server_name": "{{server_name}}",
  "node_id": "{{node_id}}",
  "detail": "{{detail}}",
  "timestamp": "{{timestamp}}"
}
```

Rendered example:

```json
{
  "event": "cpu.overusage",
  "server_id": "11111111-2222-3333-4444-555555555555",
  "server_name": "Survival SMP",
  "node_id": "7",
  "detail": "CPU usage 91.2% exceeded the 80% allowance for more than 10 minute(s).",
  "timestamp": "2026-11-21T15:31:06.000Z"
}
```

Available placeholders:

| Placeholder | Value |
| --- | --- |
| `{{event}}` | Event name, such as `cpu.overusage` |
| `{{server_id}}` | Wings server UUID |
| `{{server_name}}` | Server name reported by Wings |
| `{{node_id}}` | Node ID configured in List Server |
| `{{detail}}` | Human-readable event detail |
| `{{timestamp}}` | ISO-8601 event timestamp |

Placeholders are replaced with JSON-escaped values. The custom body must be valid JSON.

---

<p align="center">
  Copyright by <a href="https://aisbirnusantara.com">Kubunusa Kreatif Digital</a>
</p>
