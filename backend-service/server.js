/**
API Server for Google Maps Review Reporter Automation

This Express.js server provides REST API endpoints to control the automation service.
It allows the dashboard to start/stop automation and check status via HTTP requests.

Endpoints:
- POST /api/start - Start the automation service
- POST /api/stop - Stop the automation service
- GET /api/status - Get current automation status
- GET /health - Health check endpoint
 */

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Debug: Check environment variables on server startup
console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   🔍 Server Environment Check                              ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('Environment variables:');
console.log('  PORT:', process.env.PORT || '3001 (default)');
console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ SET' : '❌ NOT SET');
console.log('  SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? '✅ SET' : '❌ NOT SET');
console.log('');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('⚠️  WARNING: Missing Supabase credentials!');
  console.error('   The automation will not work without these.');
  console.error('   Please set SUPABASE_URL and SUPABASE_ANON_KEY in Render environment variables.');
  console.error('');
}

// Initialize Supabase client for testing
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const { AutomationService } = require('./automation-service-api');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration for Figma Make
app.use(cors({
  origin: '*', // Allow all origins (required for Figma Make)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json());

// Initialize automation service
const automationService = new AutomationService();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Google Maps Review Reporter API',
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to check environment variables
app.get('/debug/env', (req, res) => {
  res.json({
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
    supabaseUrlPrefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 30) + '...' : 'NOT SET',
    supabaseKeyPrefix: process.env.SUPABASE_ANON_KEY ? process.env.SUPABASE_ANON_KEY.substring(0, 20) + '...' : 'NOT SET',
    nodeEnv: process.env.NODE_ENV || 'not set',
    port: process.env.PORT || '3001 (default)'
  });
});

// Debug endpoint to test Supabase connection
app.get('/debug/supabase', async (req, res) => {
  try {
    // Test 1: Check if we can query the reviews table
    const { data: reviews, error: reviewsError } = await supabase
      .from('reviews')
      .select('id, status')
      .limit(1);
    
    // Test 2: Check if we can query the gmail_accounts table
    const { data: accounts, error: accountsError } = await supabase
      .from('gmail_accounts')
      .select('id, email')
      .limit(1);
    
    res.json({
      success: !reviewsError && !accountsError,
      reviewsTest: {
        success: !reviewsError,
        error: reviewsError ? reviewsError.message : null,
        count: reviews ? reviews.length : 0
      },
      accountsTest: {
        success: !accountsError,
        error: accountsError ? accountsError.message : null,
        count: accounts ? accounts.length : 0
      },
      message: !reviewsError && !accountsError 
        ? '✅ Supabase connection working!' 
        : '❌ Supabase connection failed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: '❌ Unexpected error testing Supabase'
    });
  }
});

// Get automation status
app.get('/api/status', (req, res) => {
  const status = automationService.getStatus();
  res.json(status);
});

// Start automation
app.post('/api/start', async (req, res) => {
  try {
    if (automationService.isRunning) {
      return res.status(400).json({ 
        error: 'Automation is already running',
        isRunning: true
      });
    }

    await automationService.start();
    
    res.json({ 
      message: 'Automation started successfully',
      isRunning: true,
      startedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error starting automation:', error);
    res.status(500).json({ 
      error: 'Failed to start automation',
      message: error.message,
      isRunning: false
    });
  }
});

// Stop automation
app.post('/api/stop', async (req, res) => {
  try {
    if (!automationService.isRunning) {
      return res.status(400).json({ 
        error: 'Automation is not running',
        isRunning: false
      });
    }

    await automationService.stop();
    
    res.json({ 
      message: 'Automation stopped successfully',
      isRunning: false,
      stoppedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error stopping automation:', error);
    res.status(500).json({ 
      error: 'Failed to stop automation',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start the server
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   Google Maps Review Reporter - API Server                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('📋 Available endpoints:');
  console.log(`   GET  /health           - Health check`);
  console.log(`   GET  /api/status       - Get automation status`);
  console.log(`   POST /api/start        - Start automation`);
  console.log(`   POST /api/stop         - Stop automation`);
  console.log('');
  console.log('🌐 Dashboard can now control automation via these endpoints');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📪 SIGTERM received, shutting down gracefully...');
  await automationService.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📪 SIGINT received, shutting down gracefully...');
  await automationService.stop();
  process.exit(0);
});
