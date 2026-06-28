import { spawn } from 'child_process';

console.log("Starting Shopify Remix App via Hostinger (Node directly)...");

const server = spawn('node', ['./node_modules/@react-router/serve/bin/react-router-serve.js', './build/server/index.js'], {
  stdio: 'inherit',
  shell: true,
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
});

server.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
});
