import { spawn } from 'child_process';

console.log("Starting Shopify Remix App via Hostinger (Node directly)...");

const port = process.env.PORT || 3000;
console.log(`Ensuring Prisma database is setup...`);

const generate = spawn(process.execPath, ['./node_modules/.bin/prisma', 'generate'], {
  stdio: 'inherit',
  shell: true,
});

generate.on('close', (code) => {
  const migrate = spawn(process.execPath, ['./node_modules/.bin/prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: true,
  });

  migrate.on('close', (code) => {
    console.log(`Prisma setup exited. Launching server on port ${port}...`);
    const server = spawn(process.execPath, ['./node_modules/.bin/react-router-serve', './build/server/index.js'], {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, PORT: port }
    });

    server.on('error', (err) => {
      console.error('Failed to start server:', err);
    });

    server.on('close', (code) => {
      console.log(`Server process exited with code ${code}`);
    });
  });
});
