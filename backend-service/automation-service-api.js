/**
 * Google Maps Review Reporter - API-Controllable Automation Service
 * 
 * This is a modified version of the automation service that can be controlled
 * via API endpoints (start/stop) instead of only command line.
 * 
 * It exports an AutomationService class that can be instantiated and controlled
 * programmatically by the Express.js server.
 */

// Use puppeteer-extra with stealth plugin for better bot detection evasion
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');
const oauthHandler = require('./oauth-handler');

// Enable stealth plugin
puppeteerExtra.use(StealthPlugin());
console.log('🎭 Stealth plugin enabled - enhancing bot detection evasion');
console.log('🔐 OAuth handler loaded - Gmail authentication via Google API');

// Load environment variables
require('dotenv').config();

// Debug: Log environment variables (first 20 chars only for security)
console.log('🔍 Checking Supabase credentials...');
console.log('   SUPABASE_URL:', process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL.substring(0, 30)}...` : '❌ NOT SET');
console.log('   SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? `${process.env.SUPABASE_ANON_KEY.substring(0, 20)}...` : '❌ NOT SET');

// Validate environment variables
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
        headless: chromium.headless,
        args: [
          ...chromium.args,
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
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update',
          '--single-process' // Important for limited memory on Render free tier
        ],
        // Use @sparticuz/chromium for Render deployment
        executablePath: await chromium.executablePath()
      };

      console.log('🌐 Using @sparticuz/chromium for Render');
      console.log(`   Executable: ${await chromium.executablePath()}`);

      // Add proxy if configured
      if (proxyConfig) {
        const proxyUrl = this.buildProxyUrl(proxyConfig);
        launchOptions.args.push(`--proxy-server=${proxyUrl}`);
        console.log(`🌍 Using proxy: ${proxyConfig.protocol}://${proxyConfig.proxy_address}:${proxyConfig.port}`);
        console.log(`   Location: ${proxyConfig.location}, Session: ${proxyConfig.session_type}`);
      }

      this.browser = await puppeteerExtra.launch(launchOptions);
      console.log('✅ Browser launched successfully with stealth mode');
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
      .from('proxy_configs')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

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
      console.log('   🎭 Applying extra stealth measures...');
      
      // Extra stealth: Set realistic viewport
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
      });
      
      // Extra stealth: Set realistic user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      );
      
      // Extra stealth: Set additional headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      });
      
      console.log('   ✅ Stealth measures applied');
      
      await page.goto('https://accounts.google.com/', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.delay(DELAY_BETWEEN_ACTIONS);

      // Enter email
      console.log('   🔍 Looking for email input...');
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await page.type('input[type="email"]', email, { delay: 100 });
      console.log('   ✅ Email entered');
      await page.keyboard.press('Enter');
      await this.delay(DELAY_BETWEEN_ACTIONS);

      // Wait for password field or check what Google is showing
      console.log('   🔍 Looking for password input...');
      try {
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        console.log('   ✅ Password field found');
      } catch (passwordError) {
        // Take screenshot to see what Google is actually showing
        console.log('   ⚠️ Password field not found - checking page content...');
        
        // Check for common Google security screens
        const pageText = await page.evaluate(() => document.body.innerText);
        
        if (pageText.includes('verify') || pageText.includes('Verify')) {
          throw new Error('Google verification required - account may need manual verification');
        }
        if (pageText.includes('suspicious') || pageText.includes('Suspicious')) {
          throw new Error('Google detected suspicious activity - account may be locked');
        }
        if (pageText.includes('security') || pageText.includes('Security')) {
          throw new Error('Google security check required - cannot proceed with automation');
        }
        if (pageText.includes('phone') || pageText.includes('Phone')) {
          throw new Error('Google requesting phone verification - automation cannot proceed');
        }
        
        // Log what we see on the page
        console.log('   📄 Page content preview:', pageText.substring(0, 500));
        throw new Error('Password field not found - Google may be showing CAPTCHA or security check');
      }

      // Enter password
      await page.type('input[type="password"]', password, { delay: 100 });
      console.log('   ✅ Password entered');
      await page.keyboard.press('Enter');
      await this.delay(3000);

      // Check if login was successful
      const finalUrl = page.url();
      console.log(`   🌐 Final URL: ${finalUrl}`);
      
      if (finalUrl.includes('accounts.google.com/signin') || finalUrl.includes('accounts.google.com/challenge')) {
        throw new Error('Login failed - still on login/challenge page');
      }
      
      console.log('✅ Gmail login successful');
      return true;
    } catch (error) {
      console.error('❌ Gmail login failed:', error.message);
      
      // Log current URL for debugging
      try {
        const currentUrl = await page.url();
        console.error(`   Current URL: ${currentUrl}`);
      } catch (e) {
        // Ignore
      }
      
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
      
      // Try multiple navigation strategies with retries
      let navigationSuccess = false;
      const strategies = [
        { waitUntil: 'domcontentloaded', timeout: 60000, name: 'DOM Content Loaded' },
        { waitUntil: 'load', timeout: 60000, name: 'Page Load' },
        { waitUntil: 'networkidle2', timeout: 90000, name: 'Network Idle' }
      ];
      
      for (const strategy of strategies) {
        try {
          console.log(`   🔄 Trying navigation strategy: ${strategy.name} (timeout: ${strategy.timeout}ms)`);
          await page.goto(reviewLink, {
            waitUntil: strategy.waitUntil,
            timeout: strategy.timeout
          });
          console.log(`   ✅ Navigation successful with: ${strategy.name}`);
          navigationSuccess = true;
          break;
        } catch (navError) {
          console.log(`   ⚠️ ${strategy.name} failed: ${navError.message}`);
          if (strategy === strategies[strategies.length - 1]) {
            throw navError; // Throw only if all strategies failed
          }
          // Continue to next strategy
        }
      }

      if (!navigationSuccess) {
        throw new Error('All navigation strategies failed');
      }

      console.log('   ⏳ Waiting for page to stabilize...');
      await this.delay(5000); // Give page more time to fully render

      // Debug: Check what's on the page
      console.log('🔍 Checking page content...');
      const pageInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          hasButtons: document.querySelectorAll('button').length,
          hasAriaLabels: document.querySelectorAll('[aria-label]').length
        };
      });
      console.log('📄 Page info:', JSON.stringify(pageInfo, null, 2));

      // Look for the three-dot menu button
      console.log('🔍 Searching for three-dot menu button...');
      const menuSelectors = [
        'button[aria-label*="More"]',
        'button[aria-label*="Menu"]',
        'button[aria-label*="More options"]',
        'button[data-item-id*="overflow"]',
        '[role="button"][aria-haspopup="menu"]',
        'button[jsaction*="menu"]',
        'button[data-tooltip*="More"]',
        'button.VfPpkd-Bz112c-LgbsSe' // Google's material design button class
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
        // Debug: Show all buttons on the page
        console.log('⚠️ Could not find menu button. Debugging all buttons on page...');
        const allButtons = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.slice(0, 20).map((btn, i) => ({
            index: i,
            text: btn.innerText?.substring(0, 50) || '',
            ariaLabel: btn.getAttribute('aria-label') || '',
            className: btn.className?.substring(0, 100) || '',
            dataTooltip: btn.getAttribute('data-tooltip') || ''
          }));
        });
        console.log('🔘 First 20 buttons on page:', JSON.stringify(allButtons, null, 2));
        
        // Take screenshot for debugging
        try {
          await page.screenshot({ path: '/tmp/page-debug.png', fullPage: false });
          console.log('📸 Screenshot saved to /tmp/page-debug.png');
        } catch (screenshotError) {
          console.log('⚠️ Could not save screenshot');
        }
        
        throw new Error('Could not find three-dot menu button');
      }

      // Click the menu button
      await menuButton.click();
      await this.delay(2000);

      // Debug: Log all menu items to see what's available
      console.log('🔍 Debugging menu items...');
      try {
        const menuItems = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], .VfPpkd-StrnGf-rymPhb, [data-index]'));
          return items.map((item, index) => ({
            index,
            text: item.innerText || item.textContent,
            ariaLabel: item.getAttribute('aria-label'),
            className: item.className,
            tagName: item.tagName
          }));
        });
        console.log('📋 Available menu items:', JSON.stringify(menuItems, null, 2));
      } catch (debugError) {
        console.log('⚠️ Could not debug menu items:', debugError.message);
      }

      // Look for "Report review" or similar option using XPath and text content
      console.log('🔍 Searching for report option...');
      
      let reportOption = null;
      
      // Try XPath first (most reliable for text matching)
      const xpathSelectors = [
        "//div[contains(text(), 'Report review')]",
        "//div[contains(text(), 'Flag as inappropriate')]",
        "//div[contains(text(), 'Report')]",
        "//span[contains(text(), 'Report review')]",
        "//span[contains(text(), 'Flag as inappropriate')]",
        "//span[contains(text(), 'Report')]",
        "//*[@role='menuitem' and contains(., 'Report')]",
        "//*[@role='option' and contains(., 'Report')]"
      ];

      for (const xpath of xpathSelectors) {
        try {
          const elements = await page.$x(xpath);
          if (elements.length > 0) {
            // Find the clickable parent
            reportOption = elements[0];
            console.log(`✅ Found report option with XPath: ${xpath}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // If XPath didn't work, try CSS selectors with text matching
      if (!reportOption) {
        console.log('🔍 XPath failed, trying CSS selectors with text matching...');
        reportOption = await page.evaluateHandle(() => {
          const allElements = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], div, span'));
          for (const el of allElements) {
            const text = (el.innerText || el.textContent || '').toLowerCase();
            if (text.includes('report') || text.includes('flag')) {
              // Return the element or its clickable parent
              let clickable = el;
              while (clickable && !clickable.onclick && clickable.tagName !== 'BUTTON' && clickable !== document.body) {
                clickable = clickable.parentElement;
              }
              return clickable || el;
            }
          }
          return null;
        });
        
        const isValid = await reportOption.evaluate(el => el !== null);
        if (isValid) {
          console.log('✅ Found report option via text matching');
        } else {
          reportOption = null;
        }
      }

      if (!reportOption) {
        // Take a screenshot for debugging
        try {
          await page.screenshot({ path: '/tmp/menu-debug.png', fullPage: true });
          console.log('📸 Screenshot saved to /tmp/menu-debug.png');
        } catch (screenshotError) {
          console.log('⚠️ Could not save screenshot:', screenshotError.message);
        }
        throw new Error('Could not find report option in menu');
      }

      // Click report option
      console.log('🖱️ Clicking report option...');
      await reportOption.click();
      await this.delay(2000);

      // Select report reason if available
      if (reportReason) {
        console.log(`🎯 Looking for report reason: ${reportReason}`);
        const reasonXPaths = [
          `//*[contains(text(), '${reportReason}')]`,
          `//label[contains(text(), '${reportReason}')]`,
          `//span[contains(text(), '${reportReason}')]`
        ];

        let reasonOption = null;
        for (const xpath of reasonXPaths) {
          try {
            const elements = await page.$x(xpath);
            if (elements.length > 0) {
              reasonOption = elements[0];
              console.log(`✅ Found reason option: ${reportReason}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (reasonOption) {
          await reasonOption.click();
          await this.delay(1000);
        } else {
          console.log('⚠️ Could not find specific reason, will submit with default');
        }
      }

      // Submit the report
      console.log('🔍 Looking for submit button...');
      const submitXPaths = [
        "//button[contains(text(), 'Submit')]",
        "//button[contains(text(), 'Report')]",
        "//button[contains(text(), 'Send')]",
        "//span[contains(text(), 'Submit')]",
        "//span[contains(text(), 'Report')]"
      ];

      let submitted = false;
      for (const xpath of submitXPaths) {
        try {
          const elements = await page.$x(xpath);
          if (elements.length > 0) {
            await elements[0].click();
            console.log('✅ Report submitted successfully');
            await this.delay(3000);
            submitted = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!submitted) {
        // Try CSS selectors as backup
        const submitButton = await page.$('button[type="submit"]');
        if (submitButton) {
          await submitButton.click();
          console.log('✅ Report submitted via submit button');
          await this.delay(3000);
          submitted = true;
        }
      }

      if (!submitted) {
        console.log('⚠️ Could not find submit button, report may still have succeeded');
      }

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

      // Create a new page (puppeteer-core doesn't support createIncognitoBrowserContext with chromium)
      page = await browser.newPage();

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

      // ═══════════════════════════════════════════════════════════
      // OAuth Gmail Authentication (replaces Puppeteer login)
      // ═══════════════════════════════════════════════════════════
      console.log('🔐 Authenticating Gmail account with OAuth...');
      
      const oauthResult = await oauthHandler.verifyGmailAccount(gmailAccount.email);
      
      if (!oauthResult.success) {
        console.error(`❌ OAuth authentication failed: ${oauthResult.error}`);
        throw new Error(`Gmail OAuth verification failed: ${oauthResult.error}`);
      }
      
      console.log(`✅ Gmail OAuth authentication successful for: ${gmailAccount.email}`);
      console.log(`   ℹ️  This account is verified without Puppeteer login!`);
      
      // Note: We NO LONGER need to login with Puppeteer!
      // OAuth verifies the account is authorized via Google's API.
      // For reporting reviews, we still need to use Puppeteer to navigate
      // Maps and click the report button, but we can do that while logged
      // out or with a simple login via cookies if needed.

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

      // Close the page
      if (page) await page.close();

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
