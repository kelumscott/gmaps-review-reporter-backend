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
const { AutomationService } = require('./automation-service-api');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors()); // Allow cross-origin requests from dashboard
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
