import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { userRoutes } from './routes/user';
import { gatewayRoutes } from './routes/gateway';
import { billingRoutes } from './routes/billing';
import { virtualKeyRoutes } from './routes/virtualkeys';
import { providerRoutes } from './routes/providers';
import { mcpRoutes } from './routes/mcp';
import { agentRoutes } from './routes/agents';
import adminHtml from '../static/admin.html';
import dashboardHtml from '../static/dashboard.html';
import loginHtml from '../static/login.html';

const app = new Hono<{ Bindings: Env }>();

// CORS
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'x-hopcoderx-key', 'x-hopcoderx-agent', 'x-hopcoderx-metadata', 'x-hopcoderx-tag'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['x-hopcoderx-provider', 'x-hopcoderx-agent-id', 'x-hopcoderx-agent-slug', 'x-hopcoderx-resolved-model', 'x-hopcoderx-latency', 'x-hopcoderx-cache'],
}));

// Health
app.get('/', (c) => c.json({ status: 'ok', service: 'HopCoderX BDR Gateway' }));
app.get('/health', (c) => c.json({ status: 'ok', service: 'HopCoderX BDR Gateway', ts: new Date().toISOString() }));
app.get('/health/liveliness', (c) => c.json({ status: 'ok' }));

// Static pages
app.get('/admin', (c) => new Response(adminHtml, { headers: { 'Content-Type': 'text/html' } }));
app.get('/dashboard', (c) => new Response(dashboardHtml, { headers: { 'Content-Type': 'text/html' } }));
app.get('/login', (c) => new Response(loginHtml, { headers: { 'Content-Type': 'text/html' } }));

// API routes
const api = new Hono<{ Bindings: Env }>();

// Auth (public)
api.route('/auth', authRoutes());

// Admin routes (middleware applied in admin.ts)
api.route('/admin', adminRoutes());

// User routes (middleware applied in user.ts)
api.route('/user', userRoutes());

// Billing routes
api.route('/billing', billingRoutes());

// Virtual key routes (user)
api.route('/vk', virtualKeyRoutes());

// Provider config routes (admin)
api.route('/admin/providers', providerRoutes());

// Agent preset routes (CRUD at /api/admin/agents, public listing shared below)
api.route('/admin/agents', agentRoutes());

app.route('/api', api);

// MCP JSON-RPC 2.0 endpoint
app.route('/mcp', mcpRoutes());

// Gateway endpoints (no JWT auth)
const gw = gatewayRoutes();
app.route('/v1', gw);
app.route('/api/v1', gw);

export default app;
