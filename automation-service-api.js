/**
 * Google Maps Review Reporter - API-Controllable Automation Service
 * 
 * This is a modified version of the automation service that can be controlled
 * via API endpoints (start/stop) instead of only command line.
 * 
 * It exports an AutomationService class that can be instantiated and controlled
 * programmatically by the Express.js server.
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

class AutomationService {
  constructor() {
    this.browser = null;
    this.isRunning = false;
    this.pollInterval = null;
    this.currentReview = null;
    this.startedAt = null;
    this.stats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      lastProcessedAt: null
    };
  }

  /**
   * Get current automation status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      startedAt: this.startedAt,
      currentReview: this.currentReview ? {
        id: this.currentReview.id,
        businessName: this.currentReview.business_name
      } : null,
      stats: this.stats
    };
  }

  /**
   * Initialize the browser instance
   */
  async initBrowser(proxyConfig = null) {
    if (!this.browser) {
      console.log('🚀 Launching browser...');
      
      const launchOptions = {
        headless: false, // Set to true for production
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
      updated_at: new Date().toISOString()
    };

    if (gmailId) updates.gmail_id = gmailId;
    if (notes) updates.notes = notes;

    await supabase
      .from('reviews')
      .update(updates)
      .eq('id', reviewId);
  }

  /**
   * Update Gmail account last_used timestamp
   */
  async updateGmailLastUsed(gmailId) {
    await supabase
      .from('gmail_accounts')
      .update({ last_used: new Date().toISOString() })
      .eq('id', gmailId);
  }

  /**
   * Log automation activity
   */
  async logActivity(reviewId, gmailId, proxyIp, status, errorMessage = null) {
    const log = {
      review_id: reviewId,
      gmail_id: gmailId,
      proxy_ip: proxyIp,
      status,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    };

    if (errorMessage) {
      log.error_message = errorMessage;
    }

    await supabase.from('automation_logs').insert([log]);
  }

  /**
   * Login to Gmail
   */
  async loginToGmail(page, email, password) {
    try {
      console.log(`📧 Logging into Gmail: ${email}`);
      await page.goto('https://accounts.google.com/', {
        waitUntil: 'networkidle2'
      });

      await this.delay(DELAY_BETWEEN_ACTIONS);

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
        throw new Error('Could not find report option in menu');
      }

      // Click report option
      await reportOption.click();
      await this.delay(2000);

      // Select report reason if available
      if (reportReason) {
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

      this.currentReview = review;

      // Get Gmail account
      gmailAccount = await this.getAvailableGmailAccount();
      if (!gmailAccount) {
        throw new Error('No available Gmail account');
      }

      console.log(`📧 Using Gmail account: ${gmailAccount.email}`);

      // Get proxy config
      const proxyConfig = await this.getProxyConfig();
      
      // Initialize browser with proxy
      const browser = await this.initBrowser(proxyConfig);

      // Create incognito context
      const context = await browser.createIncognitoBrowserContext();
      page = await context.newPage();

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Get proxy IP if available
      if (proxyConfig) {
        try {
          await page.goto('https://api.ipify.org?format=json');
          const ipData = await page.evaluate(() => document.body.textContent);
          proxyIp = JSON.parse(ipData).ip;
          console.log(`🌐 Connected via proxy IP: ${proxyIp}`);
        } catch (e) {
          console.log('⚠️ Could not verify proxy IP');
        }
      }

      // Update review status to in_progress
      await this.updateReviewStatus(review.id, 'in_progress', gmailAccount.id);

      // Login to Gmail
      const loginSuccess = await this.loginToGmail(
        page,
        gmailAccount.email,
        gmailAccount.password
      );

      if (!loginSuccess) {
        throw new Error('Failed to login to Gmail');
      }

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

      // Update Gmail account last_used
      await this.updateGmailLastUsed(gmailAccount.id);

      // Log successful activity
      await this.logActivity(
        review.id,
        gmailAccount.id,
        proxyIp,
        'completed'
      );

      // Update stats
      this.stats.totalProcessed++;
      this.stats.successful++;
      this.stats.lastProcessedAt = new Date().toISOString();

      console.log('✅ Review processing completed successfully\n');

      // Close the incognito context
      await context.close();

    } catch (error) {
      console.error('❌ Error processing review:', error.message);

      // Update stats
      this.stats.totalProcessed++;
      this.stats.failed++;
      this.stats.lastProcessedAt = new Date().toISOString();

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
    } finally {
      this.currentReview = null;
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
  async pollForReviews() {
    if (!this.isRunning) return;

    try {
      // Get next pending review
      const review = await this.getNextPendingReview();

      if (review) {
        await this.processReview(review);
      } else {
        console.log('⏳ No pending reviews, waiting...');
      }
    } catch (error) {
      console.error('❌ Error in polling loop:', error.message);
    }

    // Schedule next poll
    if (this.isRunning) {
      this.pollInterval = setTimeout(() => this.pollForReviews(), POLL_INTERVAL_MS);
    }
  }

  /**
   * Start the automation service
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ Automation is already running');
      return;
    }

    console.log('🤖 Starting automation service...');
    console.log(`📊 Polling interval: ${POLL_INTERVAL_MS}ms`);
    
    this.isRunning = true;
    this.startedAt = new Date().toISOString();
    
    // Start polling
    this.pollForReviews();
    
    console.log('✅ Automation service started successfully');
  }

  /**
   * Stop the automation service
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ Automation is not running');
      return;
    }

    console.log('🛑 Stopping automation service...');
    
    this.isRunning = false;
    
    // Clear the polling interval
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = null;
    }

    // Close browser if open
    await this.closeBrowser();
    
    console.log('✅ Automation service stopped');
  }
}

// Export the class
module.exports = { AutomationService };
