/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPLETE automation-service-api.js WITH BOTH FIXES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ✅ Fix 1: Menu Detection - waitForSelector + 12 selectors (lines 732-892)
 * ✅ Fix 2: Review Text Extraction - extractReviewText() + auto-extraction (lines 454-621, 1247-1296)
 * 
 * INSTRUCTIONS:
 * 1. Copy EVERYTHING below this comment block
 * 2. Go to GitHub: backend-service/automation-service-api.js
 * 3. Click "Edit" (pencil icon)
 * 4. Select ALL content (Ctrl+A / Cmd+A)
 * 5. Delete and paste this code
 * 6. Scroll to bottom → "Commit changes"
 * 7. Commit message: "Fix menu detection + add review text extraction"
 * 8. Click "Commit changes"
 * 9. Wait 2-3 minutes for Render auto-deploy
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

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
    this.proxyCredentials = null; // Store proxy credentials for page.authenticate()
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
        const { proxyUrl, username, password } = this.buildProxyUrl(proxyConfig);
        launchOptions.args.push(`--proxy-server=${proxyUrl}`);
        console.log(`🌍 Using proxy: ${proxyConfig.protocol}://${proxyConfig.proxy_address}:${proxyConfig.port}`);
        console.log(`   Location: ${proxyConfig.location}, Session: ${proxyConfig.session_type}`);
        
        // Store credentials for page.authenticate()
        if (username && password) {
          this.proxyCredentials = { username, password };
          console.log(`   🔐 Proxy credentials stored for authentication`);
          console.log(`   👤 Username: ${username}`);
        } else {
          console.error(`❌ PROXY ERROR: Missing credentials!`);
        }
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
   * Automatically increments session counter for IP rotation
   */
  async getProxyConfig() {
    const { data, error } = await supabase
      .from('proxy_configs')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      console.error('❌ Error fetching proxy config:', error?.message);
      return null;
    }

    // Increment session counter for IP rotation
    const currentCounter = data.session_counter || 0;
    const maxSessions = data.max_sessions || 10000;
    const nextCounter = currentCounter >= maxSessions ? 1 : currentCounter + 1;
    
    // Update session counter in database
    await supabase
      .from('proxy_configs')
      .update({ 
        session_counter: nextCounter,
        last_session_at: new Date().toISOString()
      })
      .eq('id', data.id);
    
    console.log(`🔄 Proxy IP rotation: session ${nextCounter} / ${maxSessions}`);
    
    // Return config with updated counter for buildProxyUrl
    return { ...data, session_counter: nextCounter };
  }

  /**
   * Build proxy URL from configuration with session-based IP rotation
   * 
   * IMPORTANT: Chromium doesn't support credentials in --proxy-server arg
   * We return the URL WITHOUT credentials and the credentials separately
   * The credentials must be used with page.authenticate()
   */
  buildProxyUrl(proxyConfig) {
    const { 
      protocol, 
      username, 
      password, 
      proxy_address, 
      port,
      session_counter,
      rotation_enabled
    } = proxyConfig;
    
    // Validate required fields
    if (!username || !password || !proxy_address || !port) {
      console.error('❌ Invalid proxy config: Missing required fields');
      console.error(`   Username: ${username ? '✅' : '❌'}`);
      console.error(`   Password: ${password ? '✅' : '❌'}`);
      console.error(`   Address: ${proxy_address ? '✅' : '❌'}`);
      console.error(`   Port: ${port ? '✅' : '❌'}`);
      throw new Error('Invalid proxy configuration: Missing credentials or address');
    }
    
    const protocolPrefix = protocol.toLowerCase() === 'socks5' ? 'socks5' : 'http';
    
    // Add session ID to username for IP rotation (if enabled)
    let finalUsername = username;
    if (rotation_enabled !== false && session_counter) {
      finalUsername = `${username}-session${session_counter}`;
      console.log(`🌐 Using rotating IP with session: session${session_counter}`);
    }
    
    // Build proxy URL WITHOUT credentials (Chromium requirement)
    // Credentials will be provided via page.authenticate()
    const proxyUrl = `${protocolPrefix}://${proxy_address}:${port}`;
    
    console.log(`   🔗 Proxy server: ${proxyUrl}`);
    console.log(`   🔐 Auth will use: ${finalUsername}:${'*'.repeat(password.length)}`);
    
    return {
      proxyUrl,
      username: finalUsername,
      password: password
    };
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
   * Extract full review text and metadata from Google Maps page
   */
  async extractReviewText(page) {
    try {
      console.log('📝 Extracting review text from page...');
      
      const reviewData = await page.evaluate(() => {
        // Multiple selectors to find review text (Google uses different classes)
        const textSelectors = [
          'span[jstcache]', // Common Google Maps text container
          '[class*="MyEned"]', // Google's review text class
          '[class*="wiI7pd"]', // Another common review text class
          'div[jsaction*="review"] span',
          '[data-review-id] span',
          'div[role="article"] span',
          '.review-full-text',
          '.review-snippet'
        ];
        
        let reviewText = '';
        let maxLength = 0;
        
        // Try each selector and keep the longest text found
        for (const selector of textSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const text = (el.innerText || el.textContent || '').trim();
              // Keep text that's between 10 and 50,000 chars and longer than what we have
              if (text.length > maxLength && text.length >= 10 && text.length <= 50000) {
                // Make sure it looks like actual review content (not UI labels)
                const hasMultipleWords = text.split(/\s+/).length >= 3;
                if (hasMultipleWords) {
                  reviewText = text;
                  maxLength = text.length;
                }
              }
            }
          } catch (e) {
            // Selector might not be valid, skip it
          }
        }
        
        // If no good text found, try getting the main body text and filter it
        if (!reviewText || reviewText.length < 50) {
          const bodyText = document.body.innerText || document.body.textContent || '';
          const lines = bodyText.split('\n')
            .map(line => line.trim())
            .filter(line => {
              // Filter for lines that look like review content
              return line.length > 20 && 
                     line.length < 5000 &&
                     !line.startsWith('Google') &&
                     !line.includes('•') && // UI elements
                     !line.match(/^\d+\s*(star|stars?|★)/i); // Ratings
            });
          
          // Take the longest continuous text block
          if (lines.length > 0) {
            reviewText = lines.slice(0, 15).join('\n').trim();
          }
        }
        
        // Try to find rating
        let rating = null;
        const ratingSelectors = [
          '[aria-label*="star"]',
          '[aria-label*="Star"]',
          '[role="img"][aria-label]',
          'span[aria-label*="stars"]'
        ];
        
        for (const selector of ratingSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const ariaLabel = el.getAttribute('aria-label') || '';
              const match = ariaLabel.match(/(\d+)\s*(?:star|stars?|★)/i);
              if (match) {
                rating = parseInt(match[1]);
                break;
              }
            }
            if (rating) break;
          } catch (e) {
            // Continue
          }
        }
        
        // Try to find reviewer name
        let reviewerName = '';
        const nameSelectors = [
          'button[aria-label*="photo"]', // Reviewer profile button
          'div[data-review-id] button',
          '.section-review-title',
          'h3[class*="review"]'
        ];
        
        for (const selector of nameSelectors) {
          try {
            const el = document.querySelector(selector);
            if (el) {
              const text = (el.innerText || el.textContent || '').trim();
              if (text && text.length > 0 && text.length < 255) {
                reviewerName = text;
                break;
              }
            }
          } catch (e) {
            // Continue
          }
        }
        
        // Try to find review date
        let reviewDate = '';
        const dateSelectors = [
          'span[class*="rsqaWe"]', // Google Maps date class
          '.section-review-publish-date',
          'span[aria-label*="ago"]',
          'span[class*="review-date"]'
        ];
        
        for (const selector of dateSelectors) {
          try {
            const el = document.querySelector(selector);
            if (el) {
              const text = (el.innerText || el.textContent || '').trim();
              if (text && text.length > 0 && text.length < 100) {
                reviewDate = text;
                break;
              }
            }
          } catch (e) {
            // Continue
          }
        }
        
        return {
          reviewText: reviewText.substring(0, 50000), // Limit to 50K chars max
          rating,
          reviewerName: reviewerName.substring(0, 255),
          reviewDate: reviewDate.substring(0, 100)
        };
      });
      
      console.log(`✅ Extracted review data:`);
      console.log(`   Review text length: ${reviewData.reviewText.length} characters`);
      console.log(`   Rating: ${reviewData.rating || 'N/A'} stars`);
      console.log(`   Reviewer: ${reviewData.reviewerName || 'N/A'}`);
      console.log(`   Date: ${reviewData.reviewDate || 'N/A'}`);
      
      if (reviewData.reviewText.length > 100) {
        console.log(`   Preview: ${reviewData.reviewText.substring(0, 100)}...`);
      }
      
      return reviewData;
      
    } catch (error) {
      console.error('❌ Failed to extract review text:', error.message);
      return {
        reviewText: '',
        rating: null,
        reviewerName: '',
        reviewDate: ''
      };
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
      console.log('🖱️ Clicking menu button...');
      console.log('   ⏳ Waiting for menu to open...');
      
      // Wait for menu/popup to actually appear (not just blind delay)
      try {
        await page.waitForSelector('[role="menu"], [role="listbox"], div[jsaction*="click."], [data-menu-id], .menu-popup', {
          visible: true,
          timeout: 10000
        });
        console.log('   ✅ Menu popup appeared');
      } catch (waitError) {
        console.log('   ⚠️ Menu popup selector not found (continuing anyway...)');
      }
      
      // Additional delay for menu items to render
      await this.delay(6000);

      // Debug: Log all menu items to see what's available (EXPANDED SEARCH)
      console.log('🔍 Debugging menu items (expanded search)...');
      try {
        const menuItems = await page.evaluate(() => {
          // Try multiple selector strategies to find menu items
          const selectors = [
            '[role="menuitem"]',
            '[role="option"]',
            '[role="menu"] > *',
            '[role="menu"] div',
            '[role="listbox"] > *',
            '[role="listbox"] div',
            '.VfPpkd-StrnGf-rymPhb',
            '[data-index]',
            'div[jsaction*="click."]',
            'li[role]',
            'div[data-item]',
            'button[role="menuitem"]'
          ];
          
          const foundItems = new Set();
          const items = [];
          
          selectors.forEach(selector => {
            try {
              const elements = document.querySelectorAll(selector);
              elements.forEach(el => {
                if (!foundItems.has(el)) {
                  foundItems.add(el);
                  const text = (el.innerText || el.textContent || '').trim();
                  if (text && text.length > 0 && text.length < 200) {
                    items.push({
                      text: text,
                      ariaLabel: el.getAttribute('aria-label') || '',
                      role: el.getAttribute('role') || '',
                      className: el.className?.substring(0, 100) || '',
                      tagName: el.tagName,
                      selector: selector
                    });
                  }
                }
              });
            } catch (e) {
              // Selector might not be valid, skip it
            }
          });
          
          return items;
        });
        
        console.log(`📋 Available menu items: ${menuItems.length} found`);
        if (menuItems.length > 0) {
          console.log(JSON.stringify(menuItems.slice(0, 10), null, 2)); // Show first 10
        }
      } catch (debugError) {
        console.log('⚠️ Could not debug menu items:', debugError.message);
      }

      // Look for "Report review" or similar option using XPath and text content
      console.log('🔍 Searching for report option...');
      
      let reportOption = null;
      
      // Try XPath first (most reliable for text matching) - EXPANDED LIST
      const xpathSelectors = [
        "//div[contains(text(), 'Report review')]",
        "//div[contains(text(), 'Flag as inappropriate')]",
        "//div[contains(text(), 'Report')]",
        "//span[contains(text(), 'Report review')]",
        "//span[contains(text(), 'Report review')]",
        "//span[contains(text(), 'Flag as inappropriate')]",
        "//span[contains(text(), 'Report')]",
        "//*[@role='menuitem' and contains(., 'Report')]",
        "//*[@role='option' and contains(., 'Report')]",
        "//button[contains(., 'Report')]",
        "//li[contains(., 'Report')]",
        "//*[contains(@aria-label, 'Report')]",
        "//*[contains(translate(text(), 'REPORT', 'report'), 'report')]" // Case-insensitive
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

      // If XPath didn't work, try BROAD CSS selectors with text matching
      if (!reportOption) {
        console.log('🔍 XPath failed, trying BROAD CSS text search...');
        reportOption = await page.evaluateHandle(() => {
          // Search through MANY more elements
          const allElements = Array.from(document.querySelectorAll('*'));
          
          for (const el of allElements) {
            // Skip invisible elements
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              continue;
            }
            
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            
            // Look for "report" text that's not too long (to avoid parent containers)
            if (text.length > 0 && text.length < 100 && (text.includes('report') || text.includes('flag'))) {
              console.log(`Found element with report text: "${text.substring(0, 50)}" (${el.tagName})`);
              
              // Find the clickable parent (button, div with jsaction, role=menuitem, etc.)
              let clickable = el;
              let depth = 0;
              while (clickable && depth < 10) {
                if (
                  clickable.tagName === 'BUTTON' ||
                  clickable.tagName === 'A' ||
                  clickable.getAttribute('role') === 'menuitem' ||
                  clickable.getAttribute('role') === 'option' ||
                  clickable.onclick ||
                  clickable.getAttribute('jsaction') ||
                  (clickable.style && window.getComputedStyle(clickable).cursor === 'pointer')
                ) {
                  return clickable;
                }
                clickable = clickable.parentElement;
                depth++;
              }
              
              // If no clickable parent found, return the element itself
              return el;
            }
          }
          return null;
        });
        
        const isValid = await reportOption.evaluate(el => el !== null);
        if (isValid) {
          console.log('✅ Found report option via broad text search');
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
      console.log('   ⏳ Waiting for report dialog to open...');
      await this.delay(4000); // Increased delay for report dialog to fully load

      // Debug: Show all available report reasons
      console.log('🔍 Debugging available report reasons...');
      try {
        const availableReasons = await page.evaluate(() => {
          const reasons = [];
          
          // Look for radio buttons, labels, and clickable elements
          const elements = Array.from(document.querySelectorAll([
            'label',
            '[role="radio"]',
            '[role="option"]',
            '.VfPpkd-StrnGf-rymPhb',
            '[data-index]',
            'input[type="radio"] + *',
            'div[jsaction*="click"]'
          ].join(', ')));
          
          elements.forEach((el, i) => {
            const text = (el.innerText || el.textContent || '').trim();
            if (text && text.length > 0 && text.length < 200) {
              reasons.push({
                index: i,
                text: text,
                tagName: el.tagName,
                role: el.getAttribute('role') || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                className: el.className?.substring(0, 50) || ''
              });
            }
          });
          
          return reasons;
        });
        console.log('📋 Available report reasons:', JSON.stringify(availableReasons, null, 2));
      } catch (debugError) {
        console.log('⚠️ Could not debug report reasons:', debugError.message);
      }

      // Select report reason if available
      if (reportReason) {
        console.log(`🎯 Looking for report reason: "${reportReason}"`);
        
        // Try to find and click the reason option
        let reasonClicked = false;
        
        // Strategy 1: Find by exact text match (case-sensitive)
        console.log('   🔍 Strategy 1: Exact text match');
        const exactTextResult = await page.evaluate((reason) => {
          const allElements = Array.from(document.querySelectorAll('*'));
          for (const el of allElements) {
            const text = (el.innerText || el.textContent || '').trim();
            if (text === reason) {
              // Find clickable parent (label, radio button, or clickable div)
              let clickable = el;
              let depth = 0;
              while (clickable && depth < 5) {
                if (
                  clickable.tagName === 'LABEL' ||
                  clickable.getAttribute('role') === 'radio' ||
                  clickable.getAttribute('role') === 'option' ||
                  clickable.onclick ||
                  clickable.getAttribute('jsaction')
                ) {
                  clickable.click();
                  return { success: true, method: 'exact-text', element: clickable.tagName };
                }
                clickable = clickable.parentElement;
                depth++;
              }
            }
          }
          return { success: false };
        }, reportReason);
        
        if (exactTextResult.success) {
          console.log(`   ✅ Found and clicked reason via exact text match (${exactTextResult.element})`);
          reasonClicked = true;
        }
        
        // Strategy 2: Find label containing the text and click associated radio
        if (!reasonClicked) {
          console.log('   🔍 Strategy 2: Label with associated radio button');
          try {
            const labelXPath = `//label[contains(text(), '${reportReason}')]`;
            const labels = await page.$x(labelXPath);
            
            if (labels.length > 0) {
              console.log(`   ✅ Found ${labels.length} label(s) containing "${reportReason}"`);
              
              // Try to find and click associated radio button
              const radioClicked = await page.evaluate((labelIndex) => {
                const labels = Array.from(document.querySelectorAll('label'));
                const label = labels[labelIndex];
                
                if (label) {
                  // Method 1: Click the label itself
                  label.click();
                  return true;
                }
                return false;
              }, 0);
              
              if (radioClicked) {
                console.log('   ✅ Clicked label element');
                reasonClicked = true;
              }
            }
          } catch (e) {
            console.log(`   ⚠️ Strategy 2 failed: ${e.message}`);
          }
        }
        
        // Strategy 3: Find radio button with matching text in parent/sibling
        if (!reasonClicked) {
          console.log('   🔍 Strategy 3: Radio button with matching sibling text');
          const radioClicked = await page.evaluate((reason) => {
            const radios = Array.from(document.querySelectorAll('[role="radio"], input[type="radio"]'));
            
            for (const radio of radios) {
              // Check parent and sibling text
              const parent = radio.parentElement;
              const parentText = (parent?.innerText || parent?.textContent || '').trim();
              
              if (parentText.includes(reason)) {
                radio.click();
                return true;
              }
            }
            return false;
          }, reportReason);
          
          if (radioClicked) {
            console.log('   ✅ Clicked radio button via sibling text');
            reasonClicked = true;
          }
        }

        if (reasonClicked) {
          console.log(`✅ Successfully selected reason: "${reportReason}"`);
          await this.delay(1500);
        } else {
          console.log(`⚠️ Could not find reason "${reportReason}", will submit with default selection`);
          console.log(`   💡 TIP: Make sure report_reason matches the exact text from Google Maps menu`);
          console.log(`   💡 For non-English locations, use the translated text (e.g., Portuguese for Brazil)`);
        }
      }

      // Debug: Show all buttons in the report dialog
      console.log('🔍 Debugging buttons in report dialog...');
      try {
        const dialogButtons = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          return buttons.slice(0, 30).map((btn, i) => ({
            index: i,
            text: (btn.innerText || btn.textContent || '').substring(0, 100),
            ariaLabel: btn.getAttribute('aria-label') || '',
            type: btn.getAttribute('type') || '',
            className: btn.className?.substring(0, 100) || ''
          }));
        });
        console.log('🔘 Buttons in dialog:', JSON.stringify(dialogButtons, null, 2));
      } catch (debugError) {
        console.log('⚠️ Could not debug dialog buttons:', debugError.message);
      }

      // Submit the report
      console.log('🔍 Looking for submit button...');
      const submitXPaths = [
        "//button[contains(translate(text(), 'SUBMIT', 'submit'), 'submit')]",
        "//button[contains(translate(text(), 'SEND', 'send'), 'send')]", 
        "//button[contains(translate(text(), 'FLAG', 'flag'), 'flag')]",
        "//span[contains(translate(text(), 'SUBMIT', 'submit'), 'submit')]/ancestor::button",
        "//span[contains(translate(text(), 'SEND', 'send'), 'send')]/ancestor::button",
        "//*[contains(@aria-label, 'Submit')]",
        "//*[contains(@aria-label, 'Send')]",
        "//button[@type='submit']"
      ];

      let submitted = false;
      for (const xpath of submitXPaths) {
        try {
          console.log(`   🔍 Trying XPath: ${xpath}`);
          const elements = await page.$x(xpath);
          if (elements.length > 0) {
            console.log(`   ✅ Found ${elements.length} element(s), clicking first one`);
            await elements[0].click();
            console.log('✅ Report submitted successfully');
            await this.delay(3000);
            submitted = true;
            break;
          }
        } catch (e) {
          console.log(`   ⚠️ XPath failed: ${e.message}`);
          continue;
        }
      }

      if (!submitted) {
        // Try finding any button that looks like a submit button
        console.log('🔍 Trying alternative button detection...');
        const submitButton = await page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          for (const btn of buttons) {
            const text = (btn.innerText || btn.textContent || '').toLowerCase();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const type = btn.getAttribute('type') || '';
            
            // Look for submit-related keywords
            if (
              text.includes('submit') ||
              text.includes('send') ||
              text.includes('flag') ||
              text.includes('report') ||
              ariaLabel.includes('submit') ||
              ariaLabel.includes('send') ||
              type === 'submit'
            ) {
              // Exclude cancel/close buttons
              if (!text.includes('cancel') && !text.includes('close') && !text.includes('back')) {
                return btn;
              }
            }
          }
          return null;
        });
        
        const isValid = await submitButton.evaluate(el => el !== null);
        if (isValid) {
          console.log('✅ Found submit button via alternative detection');
          await submitButton.click();
          console.log('✅ Report submitted successfully');
          await this.delay(3000);
          submitted = true;
        }
      }

      if (!submitted) {
        console.log('⚠️ Could not find submit button, report may still have succeeded');
        // Take screenshot of the dialog for debugging
        try {
          await page.screenshot({ path: '/tmp/report-dialog-debug.png', fullPage: false });
          console.log('📸 Screenshot saved to /tmp/report-dialog-debug.png');
        } catch (screenshotError) {
          console.log('⚠️ Could not save screenshot');
        }
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

      // Authenticate with proxy if credentials are available
      if (this.proxyCredentials) {
        console.log(`🔐 Authenticating with proxy...`);
        await page.authenticate({
          username: this.proxyCredentials.username,
          password: this.proxyCredentials.password
        });
        console.log(`✅ Proxy authentication configured`);
      }

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

      // ═══════════════════════════════════════════════════════════
      // EXTRACT REVIEW TEXT (if not already in database)
      // ═══════════════════════════════════════════════════════════
      let reviewText = review.review_text || '';
      
      if (!reviewText || reviewText.length < 10) {
        console.log('📝 Review text not in database - extracting from page...');
        
        // Navigate to review page first
        console.log(`🗺️ Opening review link: ${review.review_link}`);
        try {
          await page.goto(review.review_link, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
          });
          await this.delay(5000); // Wait for page to stabilize
          
          // Extract review data
          const reviewData = await this.extractReviewText(page);
          
          // Save to database if we got valid text
          if (reviewData.reviewText && reviewData.reviewText.length >= 10) {
            console.log(`💾 Saving extracted review text to database (${reviewData.reviewText.length} chars)...`);
            
            const { error: updateError } = await supabase
              .from('reviews')
              .update({
                review_text: reviewData.reviewText,
                review_rating: reviewData.rating,
                reviewer_name: reviewData.reviewerName,
                review_date: reviewData.reviewDate
              })
              .eq('id', review.id);
            
            if (updateError) {
              console.error('⚠️ Failed to save review text:', updateError.message);
            } else {
              console.log('✅ Review text saved to database');
              reviewText = reviewData.reviewText; // Use for OpenAI later
            }
          } else {
            console.warn('⚠️ Could not extract review text from page');
          }
        } catch (extractError) {
          console.error('⚠️ Error extracting review text:', extractError.message);
          console.log('   Continuing with reporting anyway...');
        }
      } else {
        console.log(`✅ Review text already in database (${reviewText.length} chars)`);
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

      // Note: No need to logout - we're using OAuth, not Puppeteer login!
      // The account is verified via Google's API, not browser cookies.

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
