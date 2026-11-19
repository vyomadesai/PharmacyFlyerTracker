import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { doctorsRoutes } from './modules/doctors/doctors.routes.js';
import { campaignsRoutes } from './modules/campaigns/campaigns.routes.js';
import { deliveriesRoutes } from './modules/deliveries/deliveries.routes.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { workflowRoutes } from './modules/workflow/workflow.routes.js';
import { clientWorkflowRoutes } from './modules/client-workflow/client-workflow.routes.js';
import { npiRegisteryConfigRoutes } from './modules/npiRegisteryConfig/npiRegisteryConfig.routes.js';
import { flyerRoutesRouter } from './modules/routes/flyerRoutes.routes.js';
import { routeStopsRouter } from './modules/routes/routeStops.routes.js';
import { routePlannerRoutes } from './modules/route-planner/routePlanner.routes.js';
import { newEntriesRoutes } from './modules/new-entries/newEntries.routes.js';
import { routeThreeRoutes } from './modules/route-three/routeThree.routes.js';
import { errorMiddleware } from './middleware/error.middleware.js';

export const app = express();

const routes = {
  ok: true,
  service: 'pharmacy-flyer-tracker-backend',
  apiBaseUrlForMobile: `http://YOUR-COMPUTER-IP:${env.port}/api`,
  health: ['GET /health', 'GET /api/health'],
  auth: ['POST /api/auth/login', 'POST /auth/login'],
  workflow: ['POST /api/workflow/checkin', 'POST /api/workflow/assign-flyer', 'POST /api/workflow/upload-photo', 'POST /api/workflow/validate-flyer-match'],
  clientWorkflow: ['GET /api/client-workflow/status', 'POST /api/client-workflow/suggest', 'GET /api/client-workflow/targets', 'POST /api/client-workflow/campaign-configs', 'POST /api/client-workflow/campaign-configs/:id/suggestions', 'POST /api/client-workflow/assignments/approve', 'POST /api/client-workflow/routes/generate', 'GET /api/client-workflow/routes/today'],
  npiRegistery: ['GET /api/npi-registery/doctor/:npi', 'GET /api/npi-registery/search', 'GET /api/npi-registery/combined-doctor-search', 'POST /api/npi-registery/save'],
  routeWorkflow: ['GET /api/routes/my/today', 'GET /api/routes/my/calendar', 'GET /api/routes/my/assignments', 'GET /api/routes/stops/:id', 'POST /api/routes/stops/:id/checkin', 'POST /api/routes/stops/:id/upload-proof', 'POST /api/routes/stops/:id/complete'],
  note: 'If this page is not visible on port 4000, you are not running this backend folder.'
};

app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin }));
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => res.json(routes));
app.get('/api', (_req, res) => res.json(routes));
app.get('/routes', (_req, res) => res.json(routes));
app.get('/api/routes', (_req, res) => res.json(routes));
app.get('/health', (_req, res) => res.json({ ok: true, route: '/health' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, route: '/api/health' }));

// Auth is mounted at both paths to avoid mobile configuration mismatches:
//   API_BASE_URL=http://HOST:4000/api + post('/auth/login') => /api/auth/login
//   API_BASE_URL=http://HOST:4000     + post('/auth/login') => /auth/login
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/api/doctors', doctorsRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/deliveries', deliveriesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/client-workflow', clientWorkflowRoutes);
app.use('/api/npi-registery', npiRegisteryConfigRoutes);
app.use('/api/routes', flyerRoutesRouter);
app.use('/api/routes', routeStopsRouter);
app.use('/api/route-planner', routePlannerRoutes);
app.use('/api/new-entries', newEntriesRoutes);
app.use('/api/route-three', routeThreeRoutes);

app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return res.status(404).json({
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      expectedLoginRoutes: ['POST /api/auth/login', 'POST /auth/login'],
      checkThisFirst: `Open http://localhost:${env.port}/api/routes on the computer running backend. If it does not show expectedLoginRoutes, you are running the old/wrong backend folder.`
    });
  }
  return next();
});

app.use(errorMiddleware);
