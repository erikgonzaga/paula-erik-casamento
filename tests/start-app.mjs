import { spawn } from 'node:child_process';
// Isolated test process: synthetic keys and loopback database only.
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3101'],{
 stdio:'inherit',windowsHide:true,
 env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',
 SUPABASE_SERVICE_ROLE_KEY:'test-service-role',INVITATION_SESSION_SECRET:'local-tests-only-session-secret-123456789',
 APP_ORIGIN:'http://127.0.0.1:3101',VERCEL:'0'},
});
process.on('SIGINT',()=>child.kill());
process.on('SIGTERM',()=>child.kill());
child.on('exit',code=>process.exit(code??1));
