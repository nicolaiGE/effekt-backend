// Entry point of the Cloud Run migrate jobs (effektapi-db-migrate, geeffektivt-db-migrate), set
// by cloud.deploy.yaml: `node prisma/migrate-deploy.mjs` runs `prisma migrate deploy` after one
// mysql2 login that fills MySQL's caching_sha2_password cache.
//
// Why: after Cloud SQL restarts (maintenance), the first login of a caching_sha2_password user
// needs the full exchange. Over the /cloudsql socket Prisma's migrate engine then fails with P1000
// "Authentication failed" even with the right password (Norway, 2026-11-04 to 11-10; docs/deploy.md).
// mysql2 given the socket as a plain stream (not socketPath, which it treats as secure and sends
// the password in cleartext) fetches the server's RSA key and encrypts the password, like
// `mysql --get-server-public-key`. Once that login has succeeded, the server has the password
// cached and Prisma gets in.
import { spawnSync } from "node:child_process";
import net from "node:net";
import mysql from "mysql2/promise";

const raw = process.env.DB_URL;
if (!raw) throw new Error("DB_URL is not set");
const url = new URL(raw);
const socket = url.searchParams.get("socket");
const port = Number(url.port) || 3306;

const conn = await mysql.createConnection({
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  stream: () => (socket ? net.connect(socket) : net.connect(port, url.hostname)),
});
await conn.query("SELECT 1");
await conn.end();
console.log("Signed in once with mysql2; running prisma migrate deploy");

const { status, error } = spawnSync("./node_modules/.bin/prisma", ["migrate", "deploy"], {
  stdio: "inherit",
});
if (error) throw error;
process.exit(status ?? 1);
