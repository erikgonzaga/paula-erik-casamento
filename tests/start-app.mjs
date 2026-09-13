import { spawn } from 'node:child_process';
// Isolated test process: synthetic keys and loopback database only.
const port=Number(process.env.TEST_APP_PORT||3101);
const fixtureUrl=process.env.TEST_FIXTURE_URL||'http://127.0.0.1:54329';
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{
 stdio:'inherit',windowsHide:true,
 env:{...process.env,SUPABASE_URL:fixtureUrl,
 SUPABASE_SERVICE_ROLE_KEY:'test-service-role',INVITATION_SESSION_SECRET:'local-tests-only-session-secret-123456789',
 APP_ORIGIN:origin,VERCEL:'0'},
});
process.on('SIGINT',()=>child.kill());
process.on('SIGTERM',()=>child.kill());
child.on('exit',code=>process.exit(code??1));
