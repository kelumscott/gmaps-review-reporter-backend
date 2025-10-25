/**
 * API Server for Google Maps Review Reporter Automation
 * 
 * This Express.js server provides REST API endpoints to control the automation service.
 * It allows the dashboard to start/stop automation and check status via HTTP requests.
 * 
 * Endpoints:
 * - POST /api/start - Start the automation service
 * - POST /api/stop - Stop the automation service
 * - GET /api/status - Get current automation status
 * - GET /health - Health check endpoint
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

const AutomationService = require('./automation-service-api');
const oauthHandler = require('./oauth-handler');
const legalFormHandler = require('./legal-form-handler');
const openaiHandler = require('./openai-handler');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Phase 2 services
console.log('\n🔧 Initializing Phase 2 services...');

// Initialize OpenAI
if (process.env.OPENAI_API_KEY) {
  openaiHandler.initialize(process.env.OPENAI_API_KEY, 'gpt-4o');
  console.log('✅ OpenAI handler loaded - GPT-4o analysis ready');
} else {
  console.warn('⚠️  OpenAI API key not set - AI analysis disabled');
  console.warn('   Set OPENAI_API_KEY environment variable to enable');
}

// Initialize CapSolver
if (process.env.CAPSOLVER_API_KEY) {
  legalFormHandler.initializeCaptcha(process.env.CAPSOLVER_API_KEY);
  console.log('✅ CapSolver initialized (60% cheaper than 2Captcha)');
} else {
  console.warn('⚠️  CapSolver API key not set - CAPTCHA solving disabled');
  console.warn('   Set CAPSOLVER_API_KEY environment variable to enable legal forms');
}

console.log('');

// Middleware - CORS configuration for Figma Make
app.use(cors({
  origin: '*', // Allow all origins (required for Figma Make)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json());

// Initialize automation service
console.log('🔄 Initializing AutomationService...');
console.log('   AutomationService type:', typeof AutomationService);
console.log('   Is constructor:', typeof AutomationService === 'function');

let automationService;
try {
  automationService = new AutomationService();
  console.log('✅ AutomationService initialized successfully');
  console.log('   Has getStatus:', typeof automationService.getStatus === 'function');
  console.log('   Has start:', typeof automationService.start === 'function');
  console.log('   Has stop:', typeof automationService.stop === 'function');
} catch (error) {
  console.error('❌ FATAL: Failed to initialize AutomationService');
  console.error('   Error:', error.message);
  console.error('   Stack:', error.stack);
  process.exit(1);
}

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

// Debug endpoint to test database connection (simplified)
app.get('/debug/connection', async (req, res) => {
  try {
    // Check if Supabase is configured
    const hasConfig = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY;
    
    if (!hasConfig) {
      return res.json({
        supabase: {
          configured: false,
          error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY'
        },
        database: null
      });
    }

    // Count records in each table
    const { count: reviewsCount } = await supabase
      .from('reviews')
      .select('*', { count: 'exact', head: true });
    
    const { count: gmailCount } = await supabase
      .from('gmail_accounts')
      .select('*', { count: 'exact', head: true });
    
    const { count: proxyCount } = await supabase
      .from('proxy_configs')
      .select('*', { count: 'exact', head: true });
    
    res.json({
      supabase: {
        configured: true,
        url: process.env.SUPABASE_URL
      },
      database: {
        reviewsCount: reviewsCount || 0,
        gmailAccountsCount: gmailCount || 0,
        proxyConfigsCount: proxyCount || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      supabase: {
        configured: true,
        error: error.message
      },
      database: null
    });
  }
});

// Debug endpoint to test Supabase connection (detailed)
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
  try {
    // Check if automationService exists
    if (!automationService) {
      return res.status(500).json({
        error: 'Automation service not initialized',
        details: 'automationService is null or undefined'
      });
    }
    
    // Check if getStatus method exists
    if (typeof automationService.getStatus !== 'function') {
      return res.status(500).json({
        error: 'getStatus method not found',
        details: 'AutomationService class may not be loaded correctly',
        availableMethods: Object.keys(automationService)
      });
    }
    
    const status = automationService.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error in /api/status:', error);
    res.status(500).json({
      error: 'Failed to get automation status',
      message: error.message,
      stack: error.stack
    });
  }
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

// ═══════════════════════════════════════════════════════════
// OAuth 2.0 Endpoints for Gmail Authentication
// ═══════════════════════════════════════════════════════════

/**
 * Get OAuth authorization URL for a Gmail account
 * GET /oauth/authorize/:email
 */
app.get('/oauth/authorize/:email', (req, res) => {
  try {
    const email = req.params.email;
    
    // Check if OAuth is configured
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        error: 'OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.'
      });
    }
    
    const authUrl = oauthHandler.getAuthUrl(email);
    
    console.log(`🔐 OAuth authorization requested for: ${email}`);
    
    res.json({
      success: true,
      authUrl: authUrl,
      email: email
    });
  } catch (error) {
    console.error('❌ Error generating OAuth URL:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * OAuth callback - receives authorization code from Google
 * GET /oauth/callback?code=...&state=email
 */
app.get('/oauth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const email = req.query.state; // Email passed in state parameter
    const error = req.query.error;
    
    // User denied permission
    if (error) {
      console.log(`❌ OAuth authorization denied for ${email}: ${error}`);
      return res.send(`
        <html>
          <head>
            <title>Authorization Canceled</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #f5f5f5; }
              .container { background: white; padding: 40px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              h1 { color: #d93025; }
              p { color: #5f6368; }
              button { background: #1a73e8; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin-top: 20px; }
              button:hover { background: #1557b0; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>❌ Authorization Canceled</h1>
              <p>You canceled the authorization for <strong>${email}</strong>.</p>
              <p>Gmail account was not connected.</p>
              <button onclick="window.close()">Close Window</button>
            </div>
            <script>
              setTimeout(() => window.close(), 5000);
            </script>
          </body>
        </html>
      `);
    }
    
    if (!code) {
      throw new Error('No authorization code received from Google');
    }
    
    console.log(`✅ Received OAuth callback for: ${email}`);
    
    // Exchange authorization code for tokens
    const tokens = await oauthHandler.getTokensFromCode(code);
    
    // Save tokens to database
    await oauthHandler.saveTokens(email, tokens);
    
    console.log(`🎉 OAuth authorization successful for: ${email}`);
    
    // Show success page
    res.send(`
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #f5f5f5; }
            .container { background: white; padding: 40px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #188038; }
            p { color: #5f6368; margin: 10px 0; }
            .email { color: #1a73e8; font-weight: bold; }
            .success-icon { font-size: 48px; margin-bottom: 20px; }
            button { background: #188038; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin-top: 20px; }
            button:hover { background: #137333; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Authorization Successful!</h1>
            <p>Gmail account <span class="email">${email}</span> has been successfully connected.</p>
            <p>This account can now be used for automation without password prompts.</p>
            <p style="color: #999; font-size: 12px; margin-top: 20px;">This window will close automatically in 5 seconds...</p>
            <button onclick="window.close()">Close Window</button>
          </div>
          <script>
            setTimeout(() => {
              window.close();
              // Fallback if close doesn't work
              window.location.href = 'about:blank';
            }, 5000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    res.send(`
      <html>
        <head>
          <title>Authorization Failed</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #f5f5f5; }
            .container { background: white; padding: 40px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #d93025; }
            p { color: #5f6368; }
            .error { background: #fce8e6; padding: 12px; border-radius: 4px; color: #d93025; font-family: monospace; font-size: 12px; margin: 20px 0; }
            button { background: #d93025; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin-top: 20px; }
            button:hover { background: #b31412; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Authorization Failed</h1>
            <p>There was an error connecting your Gmail account.</p>
            <div class="error">${error.message}</div>
            <p>Please try again or contact support if the problem persists.</p>
            <button onclick="window.close()">Close Window</button>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * Test Gmail OAuth connection
 * GET /oauth/test/:email
 */
app.get('/oauth/test/:email', async (req, res) => {
  try {
    const email = req.params.email;
    const result = await oauthHandler.verifyGmailAccount(email);
    
    res.json(result);
  } catch (error) {
    console.error('❌ OAuth test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check if email has OAuth tokens
 * GET /oauth/status/:email
 */
app.get('/oauth/status/:email', async (req, res) => {
  try {
    const email = req.params.email;
    const hasTokens = await oauthHandler.hasOAuthTokens(email);
    
    res.json({
      email: email,
      hasOAuth: hasTokens,
      message: hasTokens 
        ? 'Account is authorized with OAuth' 
        : 'Account needs OAuth authorization'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
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
  console.log(`   GET  /health                    - Health check`);
  console.log(`   GET  /debug/connection          - Database connection status`);
  console.log(`   GET  /debug/supabase            - Detailed Supabase test`);
  console.log(`   GET  /debug/env                 - Environment variables`);
  console.log(`   GET  /api/status                - Get automation status`);
  console.log(`   POST /api/start                 - Start automation`);
  console.log(`   POST /api/stop                  - Stop automation`);
  console.log(`   GET  /oauth/authorize/:email    - Get OAuth authorization URL`);
  console.log(`   GET  /oauth/callback            - OAuth callback (Google redirects here)`);
  console.log(`   GET  /oauth/test/:email         - Test OAuth connection`);
  console.log(`   GET  /oauth/status/:email       - Check if account has OAuth`);
  console.log('');
  console.log('🌐 Dashboard can now control automation via these endpoints');
  console.log('🔐 OAuth endpoints available for Gmail authentication');
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
