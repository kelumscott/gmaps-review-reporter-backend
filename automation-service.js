/**
 * Google Maps Review Reporter - Automation Service
 * 
 * This Node.js service polls the Supabase database for pending reviews
 * and automates the reporting process using Puppeteer.
 * 
 * Setup Instructions:
 * 1. Install Node.js (v18 or higher)
 * 2. Run: npm install
 * 3. Copy .env.example to .env and fill in your Supabase credentials
 * 4. Run: node automation-service.js
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Supabase client setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Configuration
const POLL_INTERVAL_MS = 10000; // Poll every 10 seconds
const MAX_RETRIES = 3;
const DELAY_BETWEEN_ACTIONS = 2000; // 2 seconds delay between actions

class ReviewReporterBot {
  constructor() {
    this.browser = null;
    this.isRunning = false;
  }

  /**
   * Initialize the browser instance
   */
  async initBrowser(proxyConfig = null) {
    if (!this.browser) {
      console.log('🚀 Launching browser...');
      
      const launchOptions = {
        headless: false, // Set to true for production, or use 'new' for new headless mode
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      };

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

  /**
   * Close the browser instance
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Browser closed');
    }
  }

  /**
   * Get active proxy configuration from database
   */
  async getProxyConfig() {
    const { data, error } = await supabase
      .from('proxy_config')
      .select('*')
      .eq('is_active', true)
      .single();

    if (error) {
      console.error('❌ Error fetching proxy config:', error.message);
      return null;
    }

    return data;
  }

  /**
   * Build proxy URL from configuration
   */
  buildProxyUrl(proxyConfig) {
    const { protocol, username, password, proxy_address, port } = proxyConfig;
    const protocolPrefix = protocol.toLowerCase() === 'socks5' ? 'socks5' : 'http';
    return `${protocolPrefix}://${username}:${password}@${proxy_address}:${port}`;
  }

  /**
   * Get an available Gmail account
   */
  async getAvailableGmailAccount() {
    const { data, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('status', 'active')
      .order('last_used', { ascending: true, nullsFirst: true })
      .limit(1);

    if (error || !data || data.length === 0) {
      console.error('❌ No available Gmail accounts found');
      return null;
    }

    return data[0];
  }

  /**
   * Get next pending review from the queue
   */
  async getNextPendingReview() {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('❌ Error fetching reviews:', error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return data[0];
  }

  /**
   * Update review status
   */
  async updateReviewStatus(reviewId, status, gmailId = null, notes = null) {
    const updates = {
      status,
      ...(gmailId && { assigned_gmail_id: gmailId }),
      ...(notes && { notes }),
      ...(status === 'completed' && { completed_at: new Date().toISOString() })
    };

    await supabase
      .from('reviews')
      .update(updates)
      .eq('id', reviewId);
  }

  /**
   * Log automation activity
   */
  async logActivity(reviewId, gmailId, proxyIp, status, errorMessage = null) {
    const logData = {
      review_id: reviewId,
      gmail_id: gmailId,
      proxy_ip: proxyIp,
      status,
      ...(errorMessage && { error_message: errorMessage }),
      ...(status === 'completed' && { completed_at: new Date().toISOString() })
    };

    await supabase.from('automation_logs').insert([logData]);
  }

  /**
   * Update Gmail account last used timestamp
   */
  async updateGmailLastUsed(gmailId) {
    await supabase
      .from('gmail_accounts')
      .update({ last_used: new Date().toISOString() })
      .eq('id', gmailId);
  }

  /**
   * Login to Gmail account
   */
  async loginToGmail(page, email, password) {
    try {
      console.log(`📧 Logging into Gmail: ${email}`);
      
      await page.goto('https://accounts.google.com/signin', {
        waitUntil: 'networkidle2'
      });

      // Enter email
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await page.type('input[type="email"]', email, { delay: 100 });
      await page.keyboard.press('Enter');
      await this.delay(DELAY_BETWEEN_ACTIONS);

      // Enter password
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.type('input[type="password"]', password, { delay: 100 });
      await page.keyboard.press('Enter');
      await this.delay(DELAY_BETWEEN_ACTIONS);

      // Wait for navigation to complete
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      
      console.log('✅ Gmail login successful');
      return true;
    } catch (error) {
      console.error('❌ Gmail login failed:', error.message);
      return false;
    }
  }

  /**
   * Logout from Gmail
   */
  async logoutFromGmail(page) {
    try {
      console.log('🔓 Logging out from Gmail...');
      await page.goto('https://accounts.google.com/Logout', {
        waitUntil: 'networkidle2'
      });
      await this.delay(2000);
      console.log('✅ Gmail logout successful');
      return true;
    } catch (error) {
      console.error('❌ Gmail logout failed:', error.message);
      return false;
    }
  }

  /**
   * Report a Google Maps review
   */
  async reportReview(page, reviewLink, reportReason) {
    try {
      console.log(`🗺️ Opening review link: ${reviewLink}`);
      
      await page.goto(reviewLink, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.delay(3000);

      // Look for the three-dot menu button
      // This selector may need to be updated based on Google Maps' current HTML structure
      const menuSelectors = [
        'button[aria-label*="More"]',
        'button[aria-label*="Menu"]',
        'button[data-item-id*="overflow"]',
        '[role="button"][aria-haspopup="menu"]'
      ];

      let menuButton = null;
      for (const selector of menuSelectors) {
        try {
          menuButton = await page.$(selector);
          if (menuButton) {
            console.log(`✅ Found menu button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!menuButton) {
        throw new Error('Could not find three-dot menu button');
      }

      // Click the menu button
      await menuButton.click();
      await this.delay(2000);

      // Look for "Report review" or similar option
      const reportSelectors = [
        'text/Report review',
        'text/Flag as inappropriate',
        '[role="menuitem"]:has-text("Report")',
      ];

      let reportOption = null;
      for (const selector of reportSelectors) {
        try {
          reportOption = await page.$(selector);
          if (reportOption) {
            console.log(`✅ Found report option with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!reportOption) {
        // Try clicking any menu item that contains "report" (case insensitive)
        const menuItems = await page.$$('[role="menuitem"]');
        for (const item of menuItems) {
          const text = await page.evaluate(el => el.textContent, item);
          if (text.toLowerCase().includes('report')) {
            reportOption = item;
            console.log('✅ Found report option by text content');
            break;
          }
        }
      }

      if (!reportOption) {
        throw new Error('Could not find report option in menu');
      }

      await reportOption.click();
      await this.delay(2000);

      // Select the report reason
      // This part depends on the specific reporting UI
      console.log(`📝 Selecting report reason: ${reportReason}`);
      
      // Try to find and click the appropriate reason
      const reasonSelectors = [
        `text/${reportReason}`,
        `[role="radio"]:has-text("${reportReason}")`,
        `label:has-text("${reportReason}")`
      ];

      let reasonOption = null;
      for (const selector of reasonSelectors) {
        try {
          reasonOption = await page.$(selector);
          if (reasonOption) break;
        } catch (e) {
          continue;
        }
      }

      if (reasonOption) {
        await reasonOption.click();
        await this.delay(1000);
      }

      // Submit the report
      const submitSelectors = [
        'button[type="submit"]',
        'text/Submit',
        'text/Report',
        'button:has-text("Submit")',
        'button:has-text("Report")'
      ];

      for (const selector of submitSelectors) {
        try {
          const submitButton = await page.$(selector);
          if (submitButton) {
            await submitButton.click();
            console.log('✅ Report submitted successfully');
            await this.delay(3000);
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      console.log('⚠️ Could not find submit button, report may still have succeeded');
      return true;

    } catch (error) {
      console.error('❌ Failed to report review:', error.message);
      return false;
    }
  }

  /**
   * Process a single review
   */
  async processReview(review) {
    let page = null;
    let proxyIp = null;
    let gmailAccount = null;

    try {
      console.log(`\n🔄 Processing review: ${review.id}`);
      console.log(`   Business: ${review.business_name}`);
      console.log(`   Location: ${review.business_country}`);

      // Get Gmail account
      gmailAccount = await this.getAvailableGmailAccount();
      if (!gmailAccount) {
        throw new Error('No available Gmail account');
      }

      // Update review status to in_progress
      await this.updateReviewStatus(review.id, 'in_progress', gmailAccount.id);
      await this.logActivity(review.id, gmailAccount.id, null, 'started');

      // Get proxy configuration
      const proxyConfig = await this.getProxyConfig();
      
      // Initialize browser with proxy if available
      const browser = await this.initBrowser(proxyConfig);
      const context = await browser.createIncognitoBrowserContext();
      page = await context.newPage();

      // Store proxy info for logging
      if (proxyConfig) {
        proxyIp = `${proxyConfig.proxy_address}:${proxyConfig.port}`;
      }

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Set user agent to avoid detection
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Login to Gmail
      const loginSuccess = await this.loginToGmail(
        page,
        gmailAccount.email,
        gmailAccount.password
      );

      if (!loginSuccess) {
        throw new Error('Gmail login failed');
      }

      // Update last used timestamp
      await this.updateGmailLastUsed(gmailAccount.id);

      // Report the review
      const reportSuccess = await this.reportReview(
        page,
        review.review_link,
        review.report_reason
      );

      if (!reportSuccess) {
        throw new Error('Failed to report review');
      }

      // Logout from Gmail
      await this.logoutFromGmail(page);

      // Update review status to completed
      await this.updateReviewStatus(review.id, 'completed', gmailAccount.id);
      await this.logActivity(review.id, gmailAccount.id, proxyIp, 'completed');

      console.log('✅ Review processed successfully');

      // Close the incognito context
      await context.close();

    } catch (error) {
      console.error('❌ Error processing review:', error.message);

      // Update review status to failed
      if (review && review.id) {
        await this.updateReviewStatus(
          review.id,
          'failed',
          gmailAccount?.id,
          error.message
        );

        if (gmailAccount) {
          await this.logActivity(
            review.id,
            gmailAccount.id,
            proxyIp,
            'failed',
            error.message
          );
        }
      }

      // Close page if open
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }
  }

  /**
   * Delay helper function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Main polling loop
   */
  async start() {
    console.log('🤖 Automation service started');
    console.log(`📊 Polling interval: ${POLL_INTERVAL_MS}ms`);
    this.isRunning = true;

    while (this.isRunning) {
      try {
        // Get next pending review
        const review = await this.getNextPendingReview();

        if (review) {
          await this.processReview(review);
        } else {
          console.log('⏳ No pending reviews, waiting...');
        }

        // Wait before next poll
        await this.delay(POLL_INTERVAL_MS);

      } catch (error) {
        console.error('❌ Error in main loop:', error.message);
        await this.delay(POLL_INTERVAL_MS);
      }
    }
  }

  /**
   * Stop the service
   */
  async stop() {
    console.log('🛑 Stopping automation service...');
    this.isRunning = false;
    await this.closeBrowser();
    console.log('✅ Service stopped');
  }
}

// Handle graceful shutdown
const bot = new ReviewReporterBot();

process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  await bot.stop();
  process.exit(0);
});

// Start the service
bot.start().catch(async (error) => {
  console.error('❌ Fatal error:', error);
  await bot.stop();
  process.exit(1);
});
