import { createDatabase,fixtureServer } from './database-fixture.mjs';
const db=await createDatabase();
await db.query("insert into event_private_details(address) values ($1)",['ENDEREÇO DEMO PRIVADO — SOMENTE TESTE']);
const server=await fixtureServer(db);
console.log('PostgreSQL local de teste em 127.0.0.1:54329 — somente dados DEMO');
async function stop(){server.close();await db.close();process.exit();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);

