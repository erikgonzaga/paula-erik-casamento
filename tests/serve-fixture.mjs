import { createDatabase,fixtureServer } from './database-fixture.mjs';
const db=await createDatabase();
await db.query("insert into event_private_details(address) values ($1)",['R. Rio Branco, 58 – Centro\nSão Bernardo do Campo – SP']);
const port=Number(process.env.TEST_FIXTURE_PORT||54329);
const server=await fixtureServer(db,port);
console.log(`PostgreSQL local de teste em 127.0.0.1:${port} — somente dados DEMO`);
async function stop(){server.close();await db.close();process.exit();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
