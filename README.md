# LootBot

LootBot is a bilingual Arabic and English store dashboard with a Telegram catalog bot.

## Run it on your computer

Requirements: Node.js 24, pnpm, and Docker Desktop (or another PostgreSQL 16 database).

1. Install the workspace packages with `pnpm install`.
2. Copy `.env.example` to `.env` and replace `SESSION_SECRET` with a random value of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
3. Start the local database with `docker compose up -d db`.
4. Create the database tables with `pnpm db:push`.
5. Start the API and web app with `pnpm dev`.
6. Open `http://localhost:5173`. The API runs on port 5000 and is proxied by the web server.

Register an account at `/register`. To make that account a super admin in the local development database, run:

```powershell
docker compose exec db psql -U lootbot -d lootbot -c "UPDATE users SET role = 'SUPERADMIN' WHERE email = 'your@email.com';"
```

Then sign in again; super admins are sent to `/admin`.

## Publish a free hosted preview

The included `render.yaml` is configured for a free Render web service and Neon PostgreSQL. The web service serves the website and API from the same public URL.

1. Create a free PostgreSQL project on Neon and copy its connection string.
2. Push this repository to GitHub, then create a Blueprint in Render and connect the repository. Render reads `render.yaml`; paste the Neon connection string when it asks for `DATABASE_URL`. Render generates `SESSION_SECRET` for the service and creates the database tables during deployment.
3. After the deployment succeeds, open the `onrender.com` URL shown in the Render dashboard. The app is at `/` and the super admin page is at `/admin`.

The free Render service sleeps after 15 minutes without traffic, so the first visit after that can take about a minute to wake. The Neon project setup currently shows 0.5 GB storage, scale-to-zero, and autoscaling up to 2 CU. These free plans are suitable for a preview or hobby project, not a production service with important customer data. Keep `SESSION_SECRET` stable after deployment so encrypted Telegram bot tokens remain readable.

For a production build outside Render, run `pnpm build`, set `DATABASE_URL`, `SESSION_SECRET`, and `PORT`, then run `pnpm start`. The API serves both `/api/*` and the built website from one process.

## Workspace map

- `artifacts/lootbot`: React website and Vite configuration.
- `artifacts/api-server`: Express API and production web hosting.
- `lib/db`: PostgreSQL schema and Drizzle configuration.
- `lib/api-spec`: OpenAPI source of truth.
