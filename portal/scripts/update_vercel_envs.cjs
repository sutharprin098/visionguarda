const { spawn } = require('child_process');

const envs = [
  // VITE_SUPABASE_URL
  { action: 'rm', name: 'VITE_SUPABASE_URL', target: 'production' },
  { action: 'rm', name: 'VITE_SUPABASE_URL', target: 'preview' },
  { action: 'rm', name: 'VITE_SUPABASE_URL', target: 'development' },
  { action: 'add', name: 'VITE_SUPABASE_URL', target: 'production', value: 'https://kuqyhceykvisqfyghiot.supabase.co' },
  { action: 'add', name: 'VITE_SUPABASE_URL', target: 'preview', value: 'https://kuqyhceykvisqfyghiot.supabase.co' },
  { action: 'add', name: 'VITE_SUPABASE_URL', target: 'development', value: 'https://kuqyhceykvisqfyghiot.supabase.co' },

  // VITE_SUPABASE_ANON_KEY
  { action: 'rm', name: 'VITE_SUPABASE_ANON_KEY', target: 'production' },
  { action: 'rm', name: 'VITE_SUPABASE_ANON_KEY', target: 'preview' },
  { action: 'rm', name: 'VITE_SUPABASE_ANON_KEY', target: 'development' },
  { action: 'add', name: 'VITE_SUPABASE_ANON_KEY', target: 'production', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cXloY2V5a3Zpc3FmeWdoaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mzc1MjksImV4cCI6MjA5OTQxMzUyOX0.EvmBR-6sjtUO8UWBm9A0Sv9Ms5GMSs7BDsvw8fVZ8LI' },
  { action: 'add', name: 'VITE_SUPABASE_ANON_KEY', target: 'preview', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cXloY2V5a3Zpc3FmeWdoaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mzc1MjksImV4cCI6MjA5OTQxMzUyOX0.EvmBR-6sjtUO8UWBm9A0Sv9Ms5GMSs7BDsvw8fVZ8LI' },
  { action: 'add', name: 'VITE_SUPABASE_ANON_KEY', target: 'development', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cXloY2V5a3Zpc3FmeWdoaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mzc1MjksImV4cCI6MjA5OTQxMzUyOX0.EvmBR-6sjtUO8UWBm9A0Sv9Ms5GMSs7BDsvw8fVZ8LI' },

  // VITE_SUPABASE_PROJECT_ID
  { action: 'rm', name: 'VITE_SUPABASE_PROJECT_ID', target: 'production' },
  { action: 'rm', name: 'VITE_SUPABASE_PROJECT_ID', target: 'preview' },
  { action: 'rm', name: 'VITE_SUPABASE_PROJECT_ID', target: 'development' },
  { action: 'add', name: 'VITE_SUPABASE_PROJECT_ID', target: 'production', value: 'kuqyhceykvisqfyghiot' },
  { action: 'add', name: 'VITE_SUPABASE_PROJECT_ID', target: 'preview', value: 'kuqyhceykvisqfyghiot' },
  { action: 'add', name: 'VITE_SUPABASE_PROJECT_ID', target: 'development', value: 'kuqyhceykvisqfyghiot' },
];

function runCommand(cmd, args) {
  return new Promise((resolve) => {
    console.log(`Running: ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { shell: true });

    let output = '';
    let resolved = false;

    const checkOutput = (data) => {
      const str = data.toString();
      output += str;
      process.stdout.write(str);

      // Check success markers
      if (str.includes('Removed Environment Variable') || 
          str.includes('Added') || 
          str.includes('Error') ||
          str.includes('multiple_envs') ||
          str.includes('match')
      ) {
        if (!resolved) {
          resolved = true;
          setTimeout(() => {
            child.kill();
            resolve();
          }, 1500); // Wait 1.5 seconds to ensure complete save/exit
        }
      }
    };

    child.stdout.on('data', checkOutput);
    child.stderr.on('data', checkOutput);

    child.on('exit', () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    });

    child.on('error', (err) => {
      console.error(err);
      if (!resolved) {
        resolved = true;
        resolve();
      }
    });

    // Fallback timeout
    setTimeout(() => {
      if (!resolved) {
        console.log(`Command timed out, killing...`);
        resolved = true;
        child.kill();
        resolve();
      }
    }, 15000);
  });
}

async function main() {
  for (const item of envs) {
    let args = [];
    if (item.action === 'rm') {
      args = ['vercel', 'env', 'rm', item.name, item.target, '--yes', '--non-interactive'];
    } else {
      args = ['vercel', 'env', 'add', item.name, item.target, '--value', item.value, '--yes', '--non-interactive'];
    }
    await runCommand('npx.cmd', args);
    console.log('--------------------------------------------------');
  }
  console.log('All Vercel environment variables updated successfully!');
}

main();
