import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
// NEXT_PUBLIC values are inlined at build time, including server references.
// Build this isolated artifact before test:admin:http. Never deploy this build.
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build','--webpack'],{
  windowsHide:true,stdio:'inherit',env:{...process.env,
    SUPABASE_URL:'http://127.0.0.1:54331',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54331',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-anon-key',SUPABASE_SERVICE_ROLE_KEY:'test-service-role',
    INVITATION_SESSION_SECRET:'local-tests-only-session-secret-123456789',APP_ORIGIN:'http://127.0.0.1:3113',VERCEL:'0'},
});
child.on('exit',async code=>{
  if(code===0) await writeFile('.next/admin-test-build.json',JSON.stringify({buildId:(await readFile('.next/BUILD_ID','utf8')).trim()}));
  process.exit(code??1);
});
