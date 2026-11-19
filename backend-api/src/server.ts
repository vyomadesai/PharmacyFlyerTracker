import { app } from './app.js';
import { env } from './config/env.js';

app.listen(env.port, '0.0.0.0', () => {
  console.log(`Backend API running on http://localhost:${env.port}`);
  console.log(`Health check: GET http://localhost:${env.port}/api/health`);
  console.log(`Routes check: GET http://localhost:${env.port}/api/routes`);
  console.log(`Login endpoint: POST http://localhost:${env.port}/api/auth/login`);
});
