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
      await this.delay(8000); // Give page more time to fully render (increased from 5000)

      // Debug: Check what's on the page
      console.log('🔍 Checking page content...');
      const pageInfo = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return {
          url: window.location.href,
          title: document.title,
          hasButtons: buttons.length,
          hasAriaLabels: document.querySelectorAll('[aria-label]').length,
          // Check if it's REALLY the minimal collapse-only page
          isCollapseOnly: buttons.length === 1 && 
                         buttons[0].innerText?.includes('Collapse side panel'),
          firstButtonText: buttons[0]?.innerText?.trim() || ''
        };
      });
      console.log('📄 Page info:', JSON.stringify(pageInfo, null, 2));

      // ═══════════════════════════════════════════════════════════
      // CRITICAL FIX: Check if we're on the minimal/API page
      // Only navigate if it's TRULY minimal (collapse-only button)
      // ═══════════════════════════════════════════════════════════
      if (pageInfo.isCollapseOnly || (pageInfo.hasButtons === 1 && pageInfo.firstButtonText.includes('Collapse'))) {
        console.log('⚠️ DETECTED MINIMAL PAGE - Only has "Collapse side panel" button');
        console.log('🔄 This appears to be the API/data page, not the full review page');
        console.log('🔄 Attempting to navigate to full review page...');
        
        // Extract review ID and construct proper URL
        const currentUrl = pageInfo.url;
        
        // Try to extract the review contribution ID from the URL
        let reviewId = null;
        
        // Pattern 1: Look for contribution ID in the data parameter
        const dataMatch = currentUrl.match(/!1s([^!]+)/);
        if (dataMatch) {
          reviewId = dataMatch[1];
          console.log(`   ✓ Found review ID: ${reviewId}`);
        }
        
        // Pattern 2: Try to get Place ID
        const placeIdMatch = currentUrl.match(/!1s0x0:0x([a-f0-9]+)/);
        let placeId = null;
        if (placeIdMatch) {
          placeId = placeIdMatch[1];
          console.log(`   ✓ Found place ID: ${placeId}`);
        }
        
        // Strategy 1: Try to find the "View on Google Maps" or similar link on the page
        console.log('   🔍 Strategy 1: Looking for link to full review page...');
        const fullPageLink = await page.evaluate(() => {
          // Look for links that might lead to the full page
          const links = Array.from(document.querySelectorAll('a[href*="/maps/"]'));
          for (const link of links) {
            const href = link.getAttribute('href');
            if (href && !href.includes('/data=') && href.includes('contrib')) {
              return href;
            }
          }
          return null;
        });
        
        if (fullPageLink) {
          console.log(`   ✅ Found link to full page: ${fullPageLink}`);
          const fullUrl = fullPageLink.startsWith('http') ? fullPageLink : `https://www.google.com${fullPageLink}`;
          console.log(`   🔄 Navigating to: ${fullUrl}`);
          
          try {
            await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await this.delay(5000);
            console.log('   ✅ Successfully navigated to full review page');
          } catch (navError) {
            console.log('   ⚠️ Failed to navigate to full page:', navError.message);
          }
        } else {
          console.log('   ⚠️ Could not find link to full page');
        }
        
        // Strategy 2: Try clicking elements to expand the view
        if (!fullPageLink) {
          console.log('   🔍 Strategy 2: Trying to click elements to expand view...');
          
          const clicked = await page.evaluate(() => {
            // Try clicking profile images, review cards, etc.
            const clickableSelectors = [
              '[data-review-id]',
              '[jsaction*="review"]',
              'button[aria-label*="review"]',
              '.review',
              '[role="article"]'
            ];
            
            for (const selector of clickableSelectors) {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                elements[0].click();
                return true;
              }
            }
            return false;
          });
          
          if (clicked) {
            console.log('   ✅ Clicked element, waiting for page to update...');
            await this.delay(5000);
          } else {
            console.log('   ⚠️ No clickable elements found to expand view');
          }
        }
        
        // Strategy 3: Construct direct review URL if we have IDs
        if (!fullPageLink && reviewId) {
          console.log('   🔍 Strategy 3: Constructing direct place page URL...');
          
          // Try constructing different URL formats
          // NOTE: Skip /contrib/ URLs as they show the contributor's profile menu, not review menu
          const urlFormats = [
            placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : null,
            // Don't use: `https://www.google.com/maps/contrib/${reviewId}` - shows wrong menu
          ].filter(Boolean);
          
          for (const url of urlFormats) {
            try {
              console.log(`   🔄 Trying URL format: ${url}`);
              await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await this.delay(5000);
              
              // Check if we now have more buttons (successful navigation)
              const newButtonCount = await page.evaluate(() => document.querySelectorAll('button').length);
              if (newButtonCount > 5) {
                console.log(`   ✅ Success! Now have ${newButtonCount} buttons`);
                break;
              } else {
                console.log(`   ⚠️ Still minimal page (${newButtonCount} buttons)`);
              }
            } catch (e) {
              console.log(`   ⚠️ URL format failed:`, e.message);
            }
          }
        }
        
        // Final check: See if we're on a better page now
        const finalCheck = await page.evaluate(() => {
          return {
            buttons: document.querySelectorAll('button').length,
            url: window.location.href
          };
        });
        
        console.log(`📊 After navigation attempts:`);
        console.log(`   Buttons: ${finalCheck.buttons}`);
        console.log(`   URL: ${finalCheck.url}`);
        
        if (finalCheck.buttons <= 3) {
          console.log('⚠️ WARNING: Still on minimal page!');
          console.log('⚠️ This review link may not support automation.');
          console.log('💡 TIP: Try using a different review link format from Google Maps');
          
          // Don't throw error yet - still try to find menu button in case structure is different
        } else {
          console.log('✅ Successfully navigated to full page with UI controls');
        }
      } else {
        console.log('✅ Page has sufficient UI elements (', pageInfo.hasButtons, 'buttons)');
      }

      // Look for the three-dot menu button ON THE REVIEW (not main menu)
      console.log('🔍 Searching for review\'s three-dot menu button...');
      
      // IMPORTANT: Wait for buttons to fully load
      console.log('   ⏳ Waiting for review buttons to appear...');
      await this.delay(3000); // Give time for buttons to render
      
      // Strategy: Find the review container first, then find the three-dot button within it
      // This avoids clicking the main hamburger menu
      const menuButton = await page.evaluate(() => {
        // Try to find the review container first
        const reviewSelectors = [
          '[data-review-id]',
          '[jsaction*="review"]',
          'div[role="article"]',
          '.review',
          '[data-photo-index]' // Reviews often have photo containers
        ];
        
        let reviewContainer = null;
        for (const selector of reviewSelectors) {
          const containers = document.querySelectorAll(selector);
          if (containers.length > 0) {
            reviewContainer = containers[0];
            break;
          }
        }
        
        // If we found a review container, look for three-dot button within it
        if (reviewContainer) {
          console.log('   ✓ Found review container, looking for menu button inside...');
          
          const buttonSelectors = [
            'button[aria-label*="Actions"]',  // Google uses "Actions for [name]'s review"
            'button[aria-label*="More options"]',
            'button[aria-label*="More"]',
            'button[data-tooltip*="Actions"]',
            'button[data-tooltip*="More"]',
            'button[aria-haspopup="menu"]'
          ];
          
          for (const selector of buttonSelectors) {
            const button = reviewContainer.querySelector(selector);
            if (button) {
              // Mark it so we can find it from Puppeteer
              button.setAttribute('data-review-menu-found', 'true');
              return { success: true, selector: selector };
            }
          }
        }
        
        // Fallback: Look for buttons with "Actions" (Google's label for review three-dot menu)
        console.log('   ⚠️ Review container not found, trying all "Actions" buttons...');
        const allActionButtons = Array.from(document.querySelectorAll('button[aria-label*="Actions"]'));
        
        for (const button of allActionButtons) {
          const ariaLabel = button.getAttribute('aria-label') || '';
          
          // Look for "Actions for [name]'s review" pattern
          if (ariaLabel.includes('Actions') && ariaLabel.includes('review')) {
            console.log('   ✓ Found button with aria-label:', ariaLabel);
            button.setAttribute('data-review-menu-found', 'true');
            return { success: true, selector: 'button[aria-label*="Actions"]' };
          }
        }
        
        // Final fallback: Look for ALL buttons with "More" that are NOT in the main navigation
        console.log('   ⚠️ "Actions" buttons not found, trying "More" buttons...');
        const allMoreButtons = Array.from(document.querySelectorAll('button[aria-label*="More"]'));
        
        for (const button of allMoreButtons) {
          const ariaLabel = button.getAttribute('aria-label') || '';
          const buttonText = button.innerText || '';
          
          // Skip main menu buttons (they have specific text/labels)
          if (ariaLabel.includes('Main menu') || 
              ariaLabel.includes('Google apps') ||
              buttonText.includes('Menu')) {
            continue;
          }
          
          // This is likely the review's three-dot button
          button.setAttribute('data-review-menu-found', 'true');
          return { success: true, selector: 'button[aria-label*="More"]' };
        }
        
        return { success: false };
      });
      
      let actualMenuButton = null;
      if (menuButton && menuButton.success) {
        console.log(`✅ Found review menu button with selector: ${menuButton.selector}`);
        // Get the actual button element that we marked
        actualMenuButton = await page.$('button[data-review-menu-found="true"]');
      }

      if (!actualMenuButton) {
        // Debug: Show all buttons on the page
        console.log('⚠️ Could not find review menu button. Debugging all buttons on page...');
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

      // ═══════════════════════════════════════════════════════════
      // ENHANCED MENU CLICK - Multiple strategies to bypass bot detection
      // ═══════════════════════════════════════════════════════════
      
      // Strategy 1: Scroll element into view (more human-like)
      console.log('🖱️ Step 1: Scrolling menu button into view...');
      await page.evaluate(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, actualMenuButton);
      await this.delay(1000);
      
      // Strategy 2: Move mouse to button (human-like behavior)
      console.log('🖱️ Step 2: Moving mouse to button...');
      const buttonBox = await actualMenuButton.boundingBox();
      if (buttonBox) {
        await page.mouse.move(
          buttonBox.x + buttonBox.width / 2,
          buttonBox.y + buttonBox.height / 2,
          { steps: 10 } // Smooth movement
        );
        await this.delay(500);
      }
      
      // Strategy 3: Try multiple click methods
      console.log('🖱️ Step 3: Clicking menu button (trying multiple methods)...');
      let menuOpened = false;
      
      // Method 1: Standard Puppeteer click
      try {
        await actualMenuButton.click();
        console.log('   ✓ Method 1: Standard click executed');
        await this.delay(2000);
        
        // Check if menu appeared
        const menuVisible = await page.evaluate(() => {
          const menus = document.querySelectorAll('[role="menu"], [role="listbox"]');
          for (const menu of menus) {
            const style = window.getComputedStyle(menu);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              return true;
            }
          }
          return false;
        });
        
        if (menuVisible) {
          console.log('   ✅ Menu appeared after standard click!');
          menuOpened = true;
        }
      } catch (e) {
        console.log('   ⚠️ Method 1 failed:', e.message);
      }
      
      // Method 2: JavaScript click if standard click failed
      if (!menuOpened) {
        console.log('   Trying Method 2: JavaScript click...');
        try {
          await page.evaluate(el => el.click(), actualMenuButton);
          await this.delay(2000);
          
          const menuVisible = await page.evaluate(() => {
            const menus = document.querySelectorAll('[role="menu"], [role="listbox"]');
            for (const menu of menus) {
              const style = window.getComputedStyle(menu);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                return true;
              }
            }
            return false;
          });
          
          if (menuVisible) {
            console.log('   ✅ Menu appeared after JavaScript click!');
            menuOpened = true;
          }
        } catch (e) {
          console.log('   ⚠️ Method 2 failed:', e.message);
        }
      }
      
      // Method 3: Dispatch MouseEvent (most human-like)
      if (!menuOpened) {
        console.log('   Trying Method 3: Dispatch MouseEvent...');
        try {
          await page.evaluate(el => {
            const event = new MouseEvent('click', {
              view: window,
              bubbles: true,
              cancelable: true,
              buttons: 1
            });
            el.dispatchEvent(event);
          }, actualMenuButton);
          await this.delay(2000);
          
          const menuVisible = await page.evaluate(() => {
            const menus = document.querySelectorAll('[role="menu"], [role="listbox"]');
            for (const menu of menus) {
              const style = window.getComputedStyle(menu);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                return true;
              }
            }
            return false;
          });
          
          if (menuVisible) {
            console.log('   ✅ Menu appeared after MouseEvent!');
            menuOpened = true;
          }
        } catch (e) {
          console.log('   ⚠️ Method 3 failed:', e.message);
        }
      }
      
      // Method 4: Double click (last resort)
      if (!menuOpened) {
        console.log('   Trying Method 4: Double click...');
        try {
          await actualMenuButton.click({ clickCount: 2 });
          await this.delay(2000);
          
          const menuVisible = await page.evaluate(() => {
            const menus = document.querySelectorAll('[role="menu"], [role="listbox"]');
            for (const menu of menus) {
              const style = window.getComputedStyle(menu);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                return true;
              }
            }
            return false;
          });
          
          if (menuVisible) {
            console.log('   ✅ Menu appeared after double click!');
            menuOpened = true;
          }
        } catch (e) {
          console.log('   ⚠️ Method 4 failed:', e.message);
        }
      }
      
      if (!menuOpened) {
        console.log('   ⚠️ All click methods attempted, menu may not have appeared');
      }
      
      // Wait for menu/popup to fully render
      console.log('🖱️ Step 4: Waiting for menu to fully render...');
      try {
        await page.waitForSelector('[role="menu"], [role="listbox"], div[jsaction*="click."], [data-menu-id], .menu-popup', {
          visible: true,
          timeout: 8000
        });
        console.log('   ✅ Menu popup detected in DOM');
      } catch (waitError) {
        console.log('   ⚠️ Menu popup selector not found (continuing to search for items anyway...)');
      }
      
      // Additional delay for menu items to render (increased from 6 to 8 seconds)
      console.log('🖱️ Step 5: Waiting for menu items to load...');
      await this.delay(8000);

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
        } else {
          // No menu items found - additional diagnostics
          console.log('⚠️ NO MENU ITEMS FOUND - Running deep diagnostics...');
          
          // Take screenshot for debugging
          try {
            await page.screenshot({ path: '/tmp/no-menu-items-debug.png', fullPage: false });
            console.log('📸 Screenshot saved: /tmp/no-menu-items-debug.png');
          } catch (screenshotError) {
            console.log('⚠️ Could not save screenshot');
          }
          
          // Dump page HTML to see what's actually there
          try {
            const pageHTML = await page.evaluate(() => document.body.innerHTML);
            console.log(`📄 Page HTML length: ${pageHTML.length} characters`);
            console.log(`📄 HTML preview (first 2000 chars):`);
            console.log(pageHTML.substring(0, 2000));
          } catch (htmlError) {
            console.log('⚠️ Could not get page HTML');
          }
          
          // Check if there are ANY visible elements on the page
          const visibleElements = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('*'));
            let visible = 0;
            let hidden = 0;
            
            all.forEach(el => {
              const style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                visible++;
              } else {
                hidden++;
              }
            });
            
            return { visible, hidden, total: all.length };
          });
          console.log(`👁️ Element visibility: ${visibleElements.visible} visible, ${visibleElements.hidden} hidden, ${visibleElements.total} total`);
          
          // Check specifically for menu-related elements
          const menuCheck = await page.evaluate(() => {
            return {
              roleMenu: document.querySelectorAll('[role="menu"]').length,
              roleListbox: document.querySelectorAll('[role="listbox"]').length,
              roleMenuitem: document.querySelectorAll('[role="menuitem"]').length,
              hasJsaction: document.querySelectorAll('[jsaction]').length,
              allDivs: document.querySelectorAll('div').length,
              allButtons: document.querySelectorAll('button').length
            };
          });
          console.log('🔍 Menu-specific elements:', JSON.stringify(menuCheck, null, 2));
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
          // PRIORITY 1: Look for menuitemradio with "Report review" text
          console.log('   Strategy 1: Looking for role="menuitemradio" with "report" text...');
          const menuItems = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
          
          for (const item of menuItems) {
            const text = (item.innerText || item.textContent || '').trim().toLowerCase();
            if (text.includes('report') && !text.includes('share')) {
              console.log(`   ✓ Found menuitem: "${text}" (role: ${item.getAttribute('role')})`);
              item.setAttribute('data-report-item-found', 'true');
              return item;
            }
          }
          
          // PRIORITY 2: Search through all elements if menuitem not found
          console.log('   Strategy 2: Searching all elements...');
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
                const role = clickable.getAttribute('role');
                if (
                  clickable.tagName === 'BUTTON' ||
                  clickable.tagName === 'A' ||
                  role === 'menuitemradio' ||
                  role === 'menuitem' ||
                  role === 'option' ||
                  clickable.onclick ||
                  clickable.getAttribute('jsaction') ||
                  (clickable.style && window.getComputedStyle(clickable).cursor === 'pointer')
                ) {
                  console.log(`   ✓ Found clickable parent: ${clickable.tagName} (role: ${role || 'none'})`);
                  clickable.setAttribute('data-report-item-found', 'true');
                  return clickable;
                }
                clickable = clickable.parentElement;
                depth++;
              }
              
              // If no clickable parent found, return the element itself
              console.log(`   ⚠️ No clickable parent, using element itself`);
              el.setAttribute('data-report-item-found', 'true');
              return el;
            }
          }
          return null;
        });
        
        const isValid = await reportOption.evaluate(el => el !== null);
        if (isValid) {
          console.log('✅ Found report option via broad text search');
          // Re-query to get fresh element handle with the marker attribute
          const markedElement = await page.$('[data-report-item-found="true"]');
          if (markedElement) {
            reportOption = markedElement;
            console.log('   ✓ Re-queried element with data-report-item-found attribute');
          }
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

      // Verify we have a valid element handle
      console.log('🖱️ Verifying report option element...');\n      const reportOptionInfo = await reportOption.evaluate(el => {\n        return {\n          tagName: el?.tagName || null,\n          innerText: el?.innerText?.substring(0, 50) || null,\n          role: el?.getAttribute('role') || null,\n          isConnected: el?.isConnected || false\n        };\n      });\n      console.log('   Element info:', JSON.stringify(reportOptionInfo, null, 2));\n      \n      if (!reportOptionInfo.isConnected) {\n        throw new Error('Report option element is not connected to DOM');\n      }\n      \n      // Click report option (try multiple methods)\n      console.log('🖱️ Clicking report option...');
      
      let reportDialogOpened = false;
      
      // Method 1: Try clicking using page.evaluate (more reliable for dynamic elements)
      try {
        console.log('   Method 1: Clicking with page.evaluate...');
        const clicked = await page.evaluate(() => {
          const reportItem = document.querySelector('[data-report-item-found="true"]');
          if (!reportItem) return { success: false, error: 'Element not found in DOM' };
          
          try {
            reportItem.click();
            return { success: true, method: 'direct click' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        });
        
        console.log('   Click result:', JSON.stringify(clicked));
        
        if (clicked.success) {
          await this.delay(2000);
          
          // Check if dialog appeared
          const dialogVisible = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .VfPpkd-cnG4Wd');
            return dialogs.length > 0;
          });
          
          if (dialogVisible) {
            console.log('   ✅ Report dialog opened after evaluate click');
            reportDialogOpened = true;
          }
        }
      } catch (e) {
        console.log('   ⚠️ Method 1 failed:', e.message);
      }
      
      // Method 2: Try clicking via MouseEvent dispatch
      if (!reportDialogOpened) {
        console.log('   Method 2: Trying MouseEvent dispatch...');
        try {
          const clicked = await page.evaluate(() => {
            const reportItem = document.querySelector('[data-report-item-found="true"]');
            if (!reportItem) return { success: false, error: 'Element not found' };
            
            try {
              const event = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
                buttons: 1
              });
              reportItem.dispatchEvent(event);
              return { success: true, method: 'MouseEvent dispatch' };
            } catch (e) {
              return { success: false, error: e.message };
            }
          });
          
          console.log('   Click result:', JSON.stringify(clicked));
          
          if (clicked.success) {
            await this.delay(2000);
            
            const dialogVisible = await page.evaluate(() => {
              const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
              return dialogs.length > 0;
            });
            
            if (dialogVisible) {
              console.log('   ✅ Report dialog opened after MouseEvent');
              reportDialogOpened = true;
            }
          }
        } catch (e) {
          console.log('   ⚠️ Method 2 failed:', e.message);
        }
      }
      
      // Method 3: Try clicking the parent element
      if (!reportDialogOpened) {
        console.log('   Method 3: Trying parent element click...');
        try {
          const clicked = await page.evaluate(() => {
            const reportItem = document.querySelector('[data-report-item-found="true"]');
            if (!reportItem) return { success: false, error: 'Element not found' };
            
            // Try clicking parent up to 3 levels
            let current = reportItem;
            for (let i = 0; i < 3 && current; i++) {
              try {
                current.click();
                return { success: true, method: `parent level ${i}` };
              } catch (e) {
                current = current.parentElement;
              }
            }
            
            return { success: false, error: 'All parent clicks failed' };
          });
          
          console.log('   Click result:', JSON.stringify(clicked));
          
          if (clicked.success) {
            await this.delay(2000);
            
            const dialogVisible = await page.evaluate(() => {
              const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
              return dialogs.length > 0;
            });
            
            if (dialogVisible) {
              console.log('   ✅ Report dialog opened after parent click');
              reportDialogOpened = true;
            }
          }
        } catch (e) {
          console.log('   ⚠️ Method 3 failed:', e.message);
        }
      }
      
      // Final check: Did the dialog actually open?
      if (!reportDialogOpened) {
        console.log('   ❌ All click methods failed to open dialog');
        
        // One more check - maybe dialog appeared but we missed it
        const dialogCheck = await page.evaluate(() => {
          const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .VfPpkd-cnG4Wd');
          return {
            count: dialogs.length,
            visible: Array.from(dialogs).some(d => {
              const style = window.getComputedStyle(d);
              return style.display !== 'none' && style.visibility !== 'hidden';
            })
          };
        });
        
        console.log('   Dialog check result:', JSON.stringify(dialogCheck));
        
        if (!dialogCheck.visible) {
          throw new Error('Could not open report dialog after all attempts');
        } else {
          console.log('   ✅ Dialog is actually visible! Continuing...');
          reportDialogOpened = true;
        }
      }
      
      console.log('   ⏳ Waiting for report dialog to fully load...');
      await this.delay(3000); // Increased from 2s to 3s
      
      // Extra check: Wait for dialog to have content
      console.log('   ⏳ Waiting for dialog content to appear...');
      try {
        await page.waitForFunction(() => {
          const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
          if (dialogs.length === 0) return false;
          
          const lastDialog = dialogs[dialogs.length - 1];
          // Check if dialog has labels or buttons
          const hasLabels = lastDialog.querySelectorAll('label').length > 0;
          const hasButtons = lastDialog.querySelectorAll('button').length > 0;
          const hasRadios = lastDialog.querySelectorAll('[role="radio"]').length > 0;
          
          return hasLabels || hasButtons || hasRadios;
        }, { timeout: 10000 });
        console.log('   ✅ Dialog content loaded');
      } catch (waitError) {
        console.log('   ⚠️ Timeout waiting for dialog content, continuing anyway...');
      }

      // Debug: Show all available report reasons
      console.log('🔍 Debugging available report reasons...');
      try {
        const debugResult = await page.evaluate(() => {
          const reasons = [];
          const debugInfo = {};
          
          // IMPORTANT: Search ONLY inside the report dialog, not the entire page!
          // Try multiple dialog selectors
          const allDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .VfPpkd-cnG4Wd');
          debugInfo.dialogCount = allDialogs.length;
          
          if (allDialogs.length === 0) {
            debugInfo.error = 'No dialog found on page';
            return { reasons: [], debugInfo };
          }
          
          // Check EACH dialog and find the one with report-related content
          debugInfo.allDialogsInfo = [];
          let reportDialog = null;
          
          for (let i = 0; i < allDialogs.length; i++) {
            const d = allDialogs[i];
            const text = d.textContent || '';
            const labelCount = d.querySelectorAll('label').length;
            const radioCount = d.querySelectorAll('[role="radio"]').length;
            const buttonCount = d.querySelectorAll('button').length;
            
            const info = {
              index: i,
              textSnippet: text.substring(0, 150).trim(),
              labelCount,
              radioCount,
              buttonCount,
              totalElements: d.querySelectorAll('*').length,
              htmlLength: d.innerHTML.length
            };
            
            debugInfo.allDialogsInfo.push(info);
            
            // Look for report-related keywords in dialog text
            const lowerText = text.toLowerCase();
            if (
              lowerText.includes('report') ||
              lowerText.includes('fake') ||
              lowerText.includes('offensive') ||
              lowerText.includes('conflict') ||
              lowerText.includes('inappropriate')
            ) {
              reportDialog = d;
              debugInfo.selectedDialogIndex = i;
              debugInfo.selectedReason = 'Contains report-related keywords';
            }
          }
          
          // If no report-related dialog found, use last one
          if (!reportDialog) {
            reportDialog = allDialogs[allDialogs.length - 1];
            debugInfo.selectedDialogIndex = allDialogs.length - 1;
            debugInfo.selectedReason = 'Using last dialog (fallback)';
          }
          
          const dialog = reportDialog;
          debugInfo.selectedDialog = {
            textSnippet: dialog.textContent?.substring(0, 200),
            labelCount: dialog.querySelectorAll('label').length,
            radioCount: dialog.querySelectorAll('[role="radio"]').length,
            buttonCount: dialog.querySelectorAll('button').length,
            htmlLength: dialog.innerHTML.length
          };
          
          const elements = Array.from(dialog.querySelectorAll([
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
          
          return { reasons, debugInfo };
        });
        
        // Log debug info
        console.log(`   🔍 Found ${debugResult.debugInfo.dialogCount} dialog(s) on page`);
        if (debugResult.debugInfo.allDialogsInfo) {
          console.log('   📋 All dialogs found:');
          debugResult.debugInfo.allDialogsInfo.forEach((info, i) => {
            console.log(`      Dialog ${i}: ${info.labelCount} labels, ${info.radioCount} radios, ${info.buttonCount} buttons`);
            console.log(`         Text: "${info.textSnippet.substring(0, 80)}..."`);
          });
        }
        console.log(`   ✓ Using dialog #${debugResult.debugInfo.selectedDialogIndex}: ${debugResult.debugInfo.selectedReason}`);
        console.log(`   📊 Selected dialog: ${debugResult.debugInfo.selectedDialog.labelCount} labels, ${debugResult.debugInfo.selectedDialog.radioCount} radios, ${debugResult.debugInfo.selectedDialog.buttonCount} buttons`);
        console.log(`   📄 Selected dialog text: "${debugResult.debugInfo.selectedDialog.textSnippet?.substring(0, 100)}..."`);
        
        const availableReasons = debugResult.reasons;
        console.log('📋 Available report reasons:', JSON.stringify(availableReasons, null, 2));
        
        // If no reasons found, try to debug what went wrong
        if (availableReasons.length === 0) {
          console.log('⚠️ No report reasons found! Checking for issues...');
          
          // Check if dialog might be in an iframe
          const iframeCheck = await page.evaluate(() => {
            const iframes = document.querySelectorAll('iframe');
            return {
              iframeCount: iframes.length,
              iframeUrls: Array.from(iframes).map(f => f.src).slice(0, 3)
            };
          });
          console.log(`   📊 Iframes on page: ${iframeCheck.iframeCount}`);
          if (iframeCheck.iframeCount > 0) {
            console.log(`   📋 Iframe URLs: ${JSON.stringify(iframeCheck.iframeUrls)}`);
          }
          
          // Check what dialogs exist and what's in them
          const dialogInfo = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
            return Array.from(dialogs).map((d, i) => ({
              index: i,
              textContent: d.textContent?.substring(0, 300),
              buttonCount: d.querySelectorAll('button').length,
              labelCount: d.querySelectorAll('label').length,
              inputCount: d.querySelectorAll('input').length,
              className: d.className?.substring(0, 100)
            }));
          });
          console.log(`   📋 All dialogs info:`, JSON.stringify(dialogInfo, null, 2));
        }
      } catch (debugError) {
        console.log('⚠️ Could not debug report reasons:', debugError.message);
      }

      // Select report reason if available
      if (reportReason) {
        console.log(`🎯 Looking for report reason: "${reportReason}"`);
        
        // Try to find and click the reason option
        let reasonClicked = false;
        
        // Strategy 1: Find by exact text match (case-sensitive) INSIDE REPORT DIALOG
        console.log('   🔍 Strategy 1: Exact text match (inside report dialog)');
        const exactTextResult = await page.evaluate((reason) => {
          // Find the REPORT dialog (with report keywords)
          const allDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .VfPpkd-cnG4Wd');
          let reportDialog = null;
          
          for (const d of allDialogs) {
            const text = (d.textContent || '').toLowerCase();
            if (text.includes('report') || text.includes('fake') || text.includes('offensive') || text.includes('conflict')) {
              reportDialog = d;
              break;
            }
          }
          
          // Fallback to last dialog
          if (!reportDialog && allDialogs.length > 0) {
            reportDialog = allDialogs[allDialogs.length - 1];
          }
          
          if (!reportDialog) {
            return { success: false };
          }
          
          const dialog = reportDialog;
          
          const allElements = Array.from(dialog.querySelectorAll('*'));
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
        
        // Strategy 3: Find radio button with matching text in parent/sibling (inside REPORT dialog)
        if (!reasonClicked) {
          console.log('   🔍 Strategy 3: Radio button with matching sibling text (inside report dialog)');
          const radioClicked = await page.evaluate((reason) => {
            // Find the REPORT dialog
            const allDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .VfPpkd-cnG4Wd');
            let reportDialog = null;
            
            for (const d of allDialogs) {
              const text = (d.textContent || '').toLowerCase();
              if (text.includes('report') || text.includes('fake') || text.includes('offensive')) {
                reportDialog = d;
                break;
              }
            }
            
            if (!reportDialog && allDialogs.length > 0) {
              reportDialog = allDialogs[allDialogs.length - 1];
            }
            
            if (!reportDialog) {
              return false;
            }
            
            const dialog = reportDialog;
            const radios = Array.from(dialog.querySelectorAll('[role="radio"], input[type="radio"]'));
            
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

      // Debug: Show all buttons INSIDE the report dialog
      console.log('🔍 Debugging buttons inside report dialog...');
      try {
        const dialogButtons = await page.evaluate(() => {
          // Search ONLY inside dialog
          const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], .VfPpkd-cnG4Wd');
          if (!dialog) {
            console.log('   ⚠️ No dialog found for button debug');
            return [];
          }
          
          const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'));
          console.log(`   Found ${buttons.length} buttons in dialog`);
          
          return buttons.map((btn, i) => ({
            index: i,
            text: (btn.innerText || btn.textContent || '').substring(0, 100).trim(),
            ariaLabel: btn.getAttribute('aria-label') || '',
            type: btn.getAttribute('type') || '',
            className: btn.className?.substring(0, 100) || ''
          }));
        });
        console.log('🔘 Buttons in dialog:', JSON.stringify(dialogButtons, null, 2));
      } catch (debugError) {
        console.log('⚠️ Could not debug dialog buttons:', debugError.message);
      }

      // Submit the report (NO XPATH - CSS selectors only, scoped to dialog)
      console.log('🔍 Looking for submit button inside dialog...');
      
      let submitted = false;
      
      // Find submit button INSIDE the dialog
      const submitButton = await page.evaluateHandle(() => {
        // Search ONLY inside dialog
        const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], .VfPpkd-cnG4Wd');
        if (!dialog) {
          console.log('   ⚠️ No dialog found for submit button search');
          return null;
        }
        
        console.log('   ✓ Searching for submit button inside dialog...');
        const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'));
        console.log(`   Found ${buttons.length} buttons in dialog`);
        
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const type = btn.getAttribute('type') || '';
          
          console.log(`   Button: "${text}" (aria: "${ariaLabel}", type: "${type}")`);
          
          // Look for submit-related keywords
          if (
            text.includes('submit') ||
            text.includes('send') ||
            text.includes('flag') ||
            text.includes('report') ||
            text === 'next' ||
            text === 'continue' ||
            ariaLabel.includes('submit') ||
            ariaLabel.includes('send') ||
            ariaLabel.includes('next') ||
            type === 'submit'
          ) {
            // Exclude cancel/close/back buttons
            if (!text.includes('cancel') && !text.includes('close') && !text.includes('back')) {
              console.log(`   ✓ Found potential submit button: "${text}"`);
              btn.setAttribute('data-submit-button-found', 'true');
              return btn;
            }
          }
        }
        
        // Fallback: Last button in dialog (usually submit)
        if (buttons.length > 0) {
          const lastButton = buttons[buttons.length - 1];
          const lastText = (lastButton.innerText || lastButton.textContent || '').toLowerCase().trim();
          if (!lastText.includes('cancel') && !lastText.includes('close')) {
            console.log(`   ⚠️ Using last button as fallback: "${lastText}"`);
            lastButton.setAttribute('data-submit-button-found', 'true');
            return lastButton;
          }
        }
        
        return null;
      });
      
      const isValid = await submitButton.evaluate(el => el !== null);
      if (isValid) {
        console.log('✅ Found submit button');
        
        // Re-query to get fresh element handle
        const freshButton = await page.$('[data-submit-button-found="true"]');
        if (freshButton) {
          await freshButton.click();
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
module.exports = AutomationService;
