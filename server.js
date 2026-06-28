import { spawn } from 'child_process';

console.log("Starting Shopify Remix App via Hostinger...");

const server = spawn('npm', ['run', 'start'], {
  stdio: 'inherit',
  shell: true,
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
});

server.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
});
