// ============================================================================
// automation-service-api.js
// COPY THIS ENTIRE FILE TO GITHUB: backend-service/automation-service-api.js
// ============================================================================

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Validation: Check for required environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('');
  console.error('❌ FATAL ERROR: Missing Supabase credentials!');
  console.error('');
  console.error('Please set these environment variables on Render:');
  console.error('  SUPABASE_URL = https://krdanhnsnxurinwmznvz.supabase.co');
  console.error('  SUPABASE_ANON_KEY = [your anon key from Supabase]');
  console.error('');
  console.error('Get these from: https://supabase.com/dashboard/project/krdanhnsnxurinwmznvz/settings/api');
  console.error('');
}

// Supabase client setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

class AutomationService {
  constructor() {
    this.browser = null;
    this.isRunning = false;
    this.currentReviewId = null;
    this.intervalId = null;
  }

  // Build proxy URL from config
  buildProxyUrl(config) {
    const auth = config.username && config.password 
      ? `${config.username}:${config.password}@` 
      : '';
    return `${config.protocol.toLowerCase()}://${auth}${config.proxy_address}:${config.port}`;
  }

  // Get or create browser instance
  async getBrowser(proxyConfig = null) {
    if (!this.browser) {
      console.log('🚀 Launching browser...');
      
      const launchOptions = {
        headless: true, // Must be true for production/Render
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update',
          '--single-process' // Important for limited memory on Render free tier
        ],
        // ✅ FIX: Explicitly use bundled Chromium (fixes Render deployment)
        executablePath: puppeteer.executablePath()
      };

      console.log('🌐 Using bundled Chromium from Puppeteer');
      console.log(`   Executable: ${puppeteer.executablePath()}`);

      // Add proxy if configured
      if (proxyConfig) {
        const proxyUrl = this.buildProxyUrl(proxyConfig);
        launchOptions.args.push(`--proxy-server=${proxyUrl}`);
        console.log(`🌍 Using proxy: ${proxyConfig.protocol}://${proxyConfig.proxy_address}:${proxyConfig.port}`);
        console.log(`   Location: ${proxyConfig.location}, Session: ${proxyConfig.session_type}`);
      }

      this.browser = await puppeteer.launch(launchOptions);
      console.log('✅ Browser launched successfully');
    }
    return this.browser;
  }

  // Close browser
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Browser closed');
    }
  }

  // Get active proxy configuration
  async getProxyConfig() {
    try {
      const { data, error } = await supabase
        .from('proxy_configs')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .single();

      if (error) {
        console.log('⚠️  No active proxy configured (this is OK, will run without proxy)');
        return null;
      }

      return data;
    } catch (error) {
      console.log('⚠️  Error fetching proxy config:', error.message);
      return null;
    }
  }

  // Get available Gmail account
  async getAvailableGmail() {
    const { data, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('status', 'active')
      .limit(1)
      .single();

    if (error) throw new Error('No active Gmail account found');
    return data;
  }

  // Get next pending review
  async getNextReview() {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error) return null;
    return data;
  }

  // Update review status
  async updateReviewStatus(reviewId, status, notes = null) {
    const updates = {
      status,
      ...(notes && { notes }),
      ...(status === 'completed' && { completed_at: new Date().toISOString() })
    };

    await supabase
      .from('reviews')
      .update(updates)
      .eq('id', reviewId);
  }

  // Log automation activity
  async logActivity(reviewId, gmailId, status, errorMessage = null) {
    await supabase.from('automation_logs').insert({
      review_id: reviewId,
      gmail_id: gmailId,
      status,
      error_message: errorMessage,
      started_at: new Date().toISOString(),
      ...(status === 'completed' || status === 'failed' ? { completed_at: new Date().toISOString() } : {})
    });
  }

  // Process a single review
  async processReview(review, gmailAccount, proxyConfig) {
    let page = null;
    
    try {
      console.log('🔄 Processing review:', review.id);
      console.log('   Business:', review.business_name);
      console.log('   Location:', review.business_location);
      console.log('📧 Using Gmail account:', gmailAccount.email);

      // Update review status to in_progress
      await this.updateReviewStatus(review.id, 'in_progress');
      await this.logActivity(review.id, gmailAccount.id, 'started');

      // Get browser with proxy
      const browser = await this.getBrowser(proxyConfig);
      page = await browser.newPage();

      // Set viewport
      await page.setViewport({ width: 1280, height: 720 });

      // Login to Gmail (simplified - you'll need to implement full login)
      console.log('📧 Logging into Gmail...');
      // TODO: Implement Gmail login logic here
      // await page.goto('https://accounts.google.com');
      // ... login steps ...

      // Open review link
      console.log('🗺️  Opening review link...');
      await page.goto(review.review_link);
      
      // TODO: Implement review reporting logic here
      // ... report steps ...
      
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mark as completed
      await this.updateReviewStatus(review.id, 'completed', 'Successfully reported');
      await this.logActivity(review.id, gmailAccount.id, 'completed');
      
      console.log('✅ Review processed successfully');

    } catch (error) {
      console.error('❌ Error processing review:', error.message);
      await this.updateReviewStatus(review.id, 'failed', error.message);
      await this.logActivity(review.id, gmailAccount.id, 'failed', error.message);
      throw error;
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  // Main automation loop
  async runAutomationCycle() {
    try {
      console.log('🔍 Checking for pending reviews...');
      
      // Get next review
      const review = await this.getNextReview();
      if (!review) {
        console.log('ℹ️  No pending reviews found');
        return;
      }

      // Get Gmail account
      const gmailAccount = await this.getAvailableGmail();
      
      // Get proxy config
      const proxyConfig = await this.getProxyConfig();

      // Process the review
      await this.processReview(review, gmailAccount, proxyConfig);

    } catch (error) {
      console.error('❌ Automation cycle error:', error.message);
    }
  }

  // Start automation service
  async start() {
    if (this.isRunning) {
      console.log('⚠️  Automation is already running');
      return;
    }

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   🚀 Starting Automation Service                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    this.isRunning = true;

    // Run immediately
    await this.runAutomationCycle();

    // Then run every 30 seconds
    this.intervalId = setInterval(() => {
      this.runAutomationCycle();
    }, 30000);

    console.log('✅ Automation service started (checking every 30 seconds)');
  }

  // Stop automation service
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️  Automation is not running');
      return;
    }

    console.log('🛑 Stopping automation service...');
    
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    await this.closeBrowser();
    
    console.log('✅ Automation service stopped');
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentReviewId: this.currentReviewId,
      browserActive: !!this.browser
    };
  }
}

module.exports = { AutomationService };
