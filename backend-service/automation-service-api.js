/**
 * Google Maps Review Reporter - ENHANCED API-Controllable Automation Service
 * 
 * ENHANCEMENTS IN THIS VERSION:
 * ✅ Database schema-safe (handles missing columns gracefully)
 * ✅ Page type detection (detects contributor vs review pages)
 * ✅ Enhanced menu detection with 5 strategies
 * ✅ Comprehensive debugging and logging
 * ✅ Handles shortened Google Maps links properly
 * 
 * This version can be controlled via API endpoints (start/stop).
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
const REPORT_COOLDOWN_HOURS = 6; // 6 hours between reports from same email
const REVIEW_REPORT_COOLDOWN_DAYS = 3; // 3 days before reporting same review again

/**
 * Main AutomationService class
 */
class AutomationService {
  constructor() {
    this.browser = null;
    this.isRunning = false;
    this.currentReview = null;
    this.pollInterval = null;
    this.proxyCredentials = null; // Store proxy credentials
    this.startedAt = null;
    this.stats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      lastProcessedAt: null
    };
  }

  /**
   * Get automation status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      startedAt: this.startedAt,
      currentReview: this.currentReview,
      stats: this.stats
    };
  }

  /**
   * Initialize browser with proxy support
   */
  async initBrowser(proxyConfig) {
    const isProduction = !!process.env.AWS_LAMBDA_FUNCTION_VERSION || !!process.env.RENDER;

    let launchOptions;

    if (isProduction) {
      // Render/Production environment
      console.log('🌐 Launching browser in production mode (Chromium)');
      
      launchOptions = {
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        protocolTimeout: 180000  // 3 minutes for protocol timeout (fixes "Runtime.callFunctionOn timed out")
      };
    } else {
      // Development environment
      console.log('💻 Launching browser in development mode');
      
      launchOptions = {
        headless: true,
        protocolTimeout: 180000,  // 3 minutes for protocol timeout
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      };
    }

    // Add proxy configuration if available
    if (proxyConfig) {
      const proxyUrl = `${proxyConfig.host}:${proxyConfig.port}`;
      console.log(`🔒 Configuring proxy: ${proxyUrl}`);
      
      launchOptions.args = launchOptions.args || [];
      launchOptions.args.push(`--proxy-server=${proxyUrl}`);
      
      // Store credentials for later authentication
      if (proxyConfig.username && proxyConfig.password) {
        this.proxyCredentials = {
          username: proxyConfig.username,
          password: proxyConfig.password
        };
      }
    }

    this.browser = await puppeteerExtra.launch(launchOptions);
    console.log('✅ Browser initialized');
    
    return this.browser;
  }

  /**
   * Close browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Browser closed');
    }
  }

  /**
   * Get next pending review with legal intervals
   */
  async getNextPendingReview() {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('Error fetching pending review:', error);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  /**
   * Get active proxy configuration
   */
  async getNextProxyConfig() {
    console.log('🔍 Fetching active proxy configuration...');
    
    try {
      // Build query - check if 'status' column exists
      let query = supabase
        .from('proxy_configs')
        .select('*')
        .order('last_used', { ascending: true })
        .limit(1);
      
      // Try to filter by status if column exists
      try {
        const { data, error } = await query.eq('status', 'active');
        
        if (error) {
          // If error mentions 'status' column, fetch without status filter
          if (error.message && error.message.includes('status')) {
            console.log('   ℹ️  Status column not found, fetching any proxy...');
            const { data: allData, error: allError } = await supabase
              .from('proxy_configs')
              .select('*')
              .order('last_used', { ascending: true })
              .limit(1);
            
            if (allError) throw allError;
            return allData && allData.length > 0 ? allData[0] : null;
          }
          throw error;
        }
        
        return data && data.length > 0 ? data[0] : null;
      } catch (statusError) {
        console.error('❌ Error fetching proxy config:', statusError.message);
        return null;
      }
    } catch (error) {
      console.error('❌ Unexpected error in getNextProxyConfig:', error.message);
      return null;
    }
  }

  /**
   * Get next available Gmail account with legal intervals (ENHANCED - handles missing oauth_status)
   */
  async getNextGmailAccount() {
    console.log('📧 Fetching next Gmail account...');

    const cooldownTime = new Date(Date.now() - REPORT_COOLDOWN_HOURS * 60 * 60 * 1000);

    try {
      // Try with oauth_status filter first
      let query = supabase
        .from('gmail_accounts')
        .select('*')
        .or(`last_used.is.null,last_used.lt.${cooldownTime.toISOString()}`)
        .order('last_used', { ascending: true, nullsFirst: true })
        .limit(1);
      
      // Try to filter by oauth_status
      try {
        const { data, error } = await query.eq('oauth_status', 'authorized');
        
        if (error) {
          // If error mentions oauth_status column, fetch without it
          if (error.message && error.message.includes('oauth_status')) {
            console.log('   ℹ️  oauth_status column not found, fetching any account...');
            const { data: allData, error: allError } = await supabase
              .from('gmail_accounts')
              .select('*')
              .or(`last_used.is.null,last_used.lt.${cooldownTime.toISOString()}`)
              .order('last_used', { ascending: true, nullsFirst: true })
              .limit(1);
            
            if (allError) throw allError;
            
            if (!allData || allData.length === 0) {
              throw new Error('No available Gmail accounts (all in cooldown)');
            }
            
            console.log(`✅ Selected Gmail account: ${allData[0].email}`);
            return allData[0];
          }
          throw error;
        }
        
        if (!data || data.length === 0) {
          throw new Error('No available Gmail accounts (all in cooldown or not authorized)');
        }

        console.log(`✅ Selected Gmail account: ${data[0].email}`);
        return data[0];
      } catch (statusError) {
        console.error('❌ Error fetching Gmail account:', statusError);
        throw statusError;
      }
    } catch (error) {
      console.error('Error fetching Gmail account:', error);
      throw new Error(`Failed to get Gmail account: ${error.message}`);
    }
  }

  /**
   * Update review status (ENHANCED - handles missing columns)
   */
  async updateReviewStatus(reviewId, status, gmailAccountId = null, errorMessage = null) {
    try {
      const updateData = {
        status,
        gmail_account_id: gmailAccountId
      };
      
      // Try to add optional columns - remove them if they cause errors
      try {
        // Add error_message if provided
        if (errorMessage) {
          updateData.error_message = errorMessage;
        }
        
        // Add updated_at timestamp
        updateData.updated_at = new Date().toISOString();
        
        const { error } = await supabase
          .from('reviews')
          .update(updateData)
          .eq('id', reviewId);
        
        if (error) {
          // If error mentions missing columns, retry without them
          if (error.message && (error.message.includes('updated_at') || error.message.includes('error_message'))) {
            console.log('   ℹ️  Some columns missing, retrying with basic fields...');
            
            // Retry with just status and gmail_account_id
            const basicData = {
              status,
              gmail_account_id: gmailAccountId
            };
            
            const { error: retryError } = await supabase
              .from('reviews')
              .update(basicData)
              .eq('id', reviewId);
            
            if (retryError) throw retryError;
          } else {
            throw error;
          }
        }
      } catch (updateError) {
        console.error('⚠️ Could not update review status:', updateError.message);
      }
    } catch (error) {
      console.error('Error updating review status:', error.message);
    }
  }

  /**
   * Update Gmail account last_used timestamp
   */
  async updateGmailLastUsed(gmailAccountId) {
    const { error } = await supabase
      .from('gmail_accounts')
      .update({ last_used: new Date().toISOString() })
      .eq('id', gmailAccountId);

    if (error) {
      console.error('Error updating Gmail last_used:', error);
    }
  }

  /**
   * Log activity (ENHANCED - handles missing created_at column)
   */
  async logActivity(reviewId, gmailAccountId, proxyIp, status, errorMessage = null) {
    try {
      const logData = {
        review_id: reviewId,
        gmail_account_id: gmailAccountId,
        proxy_ip: proxyIp,
        status,
        error_message: errorMessage
      };
      
      // Try to add created_at
      try {
        logData.created_at = new Date().toISOString();
        const { error } = await supabase
          .from('automation_logs')
          .insert([logData]);
        
        if (error) {
          // If error mentions created_at, retry without it
          if (error.message && error.message.includes('created_at')) {
            delete logData.created_at;
            const { error: retryError } = await supabase
              .from('automation_logs')
              .insert([logData]);
            
            if (retryError) throw retryError;
          } else {
            throw error;
          }
        }
      } catch (logError) {
        console.error('⚠️ Could not log activity:', logError.message);
      }
    } catch (error) {
      console.error('Error logging activity:', error.message);
    }
  }

  /**
   * ENHANCED: Extract review text and metadata from page
   */
  async extractReviewText(page) {
    console.log('📝 Extracting review text from page...');
    
    const reviewData = await page.evaluate(() => {
      // Try to find review text
      let reviewText = '';
      const reviewSelectors = [
        '[class*="MyEned"]',           // Google Maps review text class
        '[class*="review-full-text"]',
        '[jsaction*="review.expand"]',
        'span[jsan]',
        '.section-review-text',
        '[data-review-id] span'
      ];
      
      for (const selector of reviewSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el) {
            const text = (el.innerText || el.textContent || '').trim();
            if (text && text.length > reviewText.length) {
              reviewText = text;
            }
          }
        } catch (e) {
          // Continue
        }
      }
      
      // Try to find rating
      let rating = '';
      const ratingSelectors = [
        '[class*="kvMYJc"]',  // Google Maps rating class
        '[aria-label*="stars"]',
        '[aria-label*="star"]',
        '.section-review-stars'
      ];
      
      for (const selector of ratingSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el) {
            const ariaLabel = el.getAttribute('aria-label') || '';
            const match = ariaLabel.match(/(\d+)\s*star/i);
            if (match) {
              rating = match[1];
              break;
            }
          }
        } catch (e) {
          // Continue
        }
      }
      
      // Try to find reviewer name
      let reviewerName = '';
      const nameSelectors = [
        '[class*="d4r55"]',  // Google Maps reviewer name class
        '.section-review-title',
        '[data-review-id] button[aria-label]'
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
        'span[class*="rsqaWe"]',
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
        reviewText: reviewText.substring(0, 50000),
        rating,
        reviewerName: reviewerName.substring(0, 255),
        reviewDate: reviewDate.substring(0, 100)
      };
    });
    
    console.log(`✅ Extracted review data:`);
    console.log(`   Review text: ${reviewData.reviewText.length} characters`);
    console.log(`   Rating: ${reviewData.rating || 'N/A'}`);
    console.log(`   Reviewer: ${reviewData.reviewerName || 'N/A'}`);
    console.log(`   Date: ${reviewData.reviewDate || 'N/A'}`);
    
    return reviewData;
  }

  /**
   * ENHANCED: Detect page type after navigation
   */
  async detectPageType(page) {
    console.log('🔍 Detecting page type...');
    
    const pageInfo = await page.evaluate(() => {
      const url = window.location.href;
      const title = document.title;
      const bodyText = document.body.innerText.toLowerCase();
      
      // Check URL patterns
      const isContribProfile = url.includes('/contrib/') || url.includes('/contributions');
      const isPlacePage = url.includes('/place/');
      const isReviewPage = url.includes('/reviews/') || url.includes('data=');
      
      // Check page content
      const hasReportReview = bodyText.includes('report review') || bodyText.includes('flag review');
      const hasContributions = bodyText.includes('contributions') || bodyText.includes('local guide');
      
      // Count menu buttons
      const actionButtons = document.querySelectorAll('button[aria-label*="Action"], button[aria-label*="More"], button[aria-label*="Menu"]');
      
      return {
        url,
        title,
        isContribProfile,
        isPlacePage,
        isReviewPage,
        hasReportReview,
        hasContributions,
        actionButtonCount: actionButtons.length
      };
    });
    
    console.log('📊 Page detection results:');
    console.log(`   URL: ${pageInfo.url}`);
    console.log(`   Is contributor profile: ${pageInfo.isContribProfile}`);
    console.log(`   Is place page: ${pageInfo.isPlacePage}`);
    console.log(`   Is review page: ${pageInfo.isReviewPage}`);
    console.log(`   Action buttons found: ${pageInfo.actionButtonCount}`);
    
    return pageInfo;
  }

  /**
   * ENHANCED: Report a Google Maps review with comprehensive debugging
   */
  async reportReview(page, reviewLink, reason) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 ENHANCED REPORT REVIEW PROCESS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Review link: ${reviewLink}`);
    console.log(`Report reason: ${reason}`);
    console.log('');

    try {
      // Step 1: Navigate to review page
      console.log('🗺️ Step 1: Opening review link...');
      
      const navigationStrategies = [
        { name: 'DOM Content Loaded', waitUntil: 'domcontentloaded' },
        { name: 'Network Idle', waitUntil: 'networkidle0' },
        { name: 'Load Event', waitUntil: 'load' }
      ];
      
      let navigationSuccess = false;
      for (const strategy of navigationStrategies) {
        try {
          console.log(`   🔄 Trying: ${strategy.name}`);
          await page.goto(reviewLink, {
            waitUntil: strategy.waitUntil,
            timeout: 60000  // Increased from 30s to 60s
          });
          console.log(`   ✅ Success with: ${strategy.name}`);
          navigationSuccess = true;
          break;
        } catch (e) {
          console.log(`   ⚠️ ${strategy.name} failed: ${e.message}`);
        }
      }
      
      if (!navigationSuccess) {
        throw new Error('All navigation strategies failed');
      }
      
      // Wait for page to stabilize
      await this.delay(5000);
      
      // Step 2: Detect page type
      const pageInfo = await this.detectPageType(page);
      
      // Step 3: If we're on contributor profile, try to navigate to review
      if (pageInfo.isContribProfile && !pageInfo.hasReportReview) {
        console.log('⚠️ Detected contributor profile page - need to navigate to review');
        console.log('🔄 Attempting to find review link...');
        
        // Try to find and click on a review to open it
        const reviewClicked = await page.evaluate(() => {
          const reviewLinks = document.querySelectorAll('a[href*="/reviews/"], [data-review-id]');
          if (reviewLinks.length > 0) {
            reviewLinks[0].click();
            return true;
          }
          return false;
        });
        
        if (reviewClicked) {
          console.log('✅ Clicked review link, waiting for page...');
          await this.delay(5000);
        } else {
          console.log('⚠️ Could not find review link on contributor page');
        }
      }
      
      // Step 4: Search for review three-dot menu button
      console.log('🔍 Step 2: Searching for review menu button...');
      console.log('   ⏳ Waiting for review buttons to appear (3 seconds)...');
      await this.delay(3000);
      
      // ENHANCED: Try multiple menu button selectors
      const menuButtonSelectors = [
        'button[aria-label*="Actions"]',
        'button[aria-label*="Action"]',
        'button[aria-label*="More"]',
        'button[aria-label*="Menu"]',
        'button[data-tooltip*="More"]',
        'button[jsaction*="menu"]',
        '[role="button"][aria-label*="More"]'
      ];
      
      let actualMenuButton = null;
      
      for (const selector of menuButtonSelectors) {
        try {
          const found = await page.$(selector);
          if (found) {
            // Mark it so we can find it again
            await page.evaluate((sel) => {
              const btn = document.querySelector(sel);
              if (btn) {
                btn.setAttribute('data-review-menu-found', 'true');
              }
            }, selector);
            
            actualMenuButton = await page.$('button[data-review-menu-found="true"]');
            if (actualMenuButton) {
              console.log(`✅ Found menu button: ${selector}`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!actualMenuButton) {
        // Debug: Show all buttons
        const allButtons = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.slice(0, 20).map((btn, i) => ({
            index: i,
            text: btn.innerText?.substring(0, 50) || '',
            ariaLabel: btn.getAttribute('aria-label') || '',
            className: btn.className?.substring(0, 100) || ''
          }));
        });
        console.log('🔘 First 20 buttons on page:', JSON.stringify(allButtons, null, 2));
        
        throw new Error('Could not find review menu button');
      }
      
      // Step 5: Click menu button with human-like behavior
      console.log('🖱️ Step 3: Clicking menu button...');
      
      // Scroll into view
      await page.evaluate(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, actualMenuButton);
      await this.delay(1000);
      
      // Move mouse to button
      const buttonBox = await actualMenuButton.boundingBox();
      if (buttonBox) {
        await page.mouse.move(
          buttonBox.x + buttonBox.width / 2,
          buttonBox.y + buttonBox.height / 2,
          { steps: 10 }
        );
        await this.delay(500);
      }
      
      // ENHANCED: Click button with multiple strategies
      console.log('   🖱️ Attempting click...');
      
      let clickSuccess = false;
      
      // Try 1: Regular Puppeteer click
      try {
        await actualMenuButton.click();
        console.log('   ✅ Regular click executed');
        clickSuccess = true;
      } catch (e) {
        console.log('   ⚠️ Regular click failed:', e.message);
      }
      
      // Try 2: JavaScript click if regular failed
      if (!clickSuccess) {
        try {
          await page.evaluate(el => el.click(), actualMenuButton);
          console.log('   ✅ JavaScript click executed');
          clickSuccess = true;
        } catch (e) {
          console.log('   ⚠️ JavaScript click failed:', e.message);
        }
      }
      
      // Try 3: Focus + Enter key
      if (!clickSuccess) {
        try {
          await actualMenuButton.focus();
          await page.keyboard.press('Enter');
          console.log('   ✅ Focus + Enter executed');
          clickSuccess = true;
        } catch (e) {
          console.log('   ⚠️ Focus + Enter failed:', e.message);
        }
      }
      
      if (!clickSuccess) {
        throw new Error('All click strategies failed for menu button');
      }
      
      console.log('   ⏳ Waiting for menu to render (3 seconds)...');
      await this.delay(3000);
      
      // DIAGNOSTIC: Check what appeared after click
      console.log('   🔍 Checking page state after menu button click...');
      const afterClickState = await page.evaluate(() => {
        const result = {
          menuElements: {
            roleMenu: document.querySelectorAll('[role="menu"]').length,
            roleListbox: document.querySelectorAll('[role="listbox"]').length,
            roleDialog: document.querySelectorAll('[role="dialog"]').length,
            anyRole: document.querySelectorAll('[role]').length
          },
          recentlyAddedElements: [],
          highZIndexElements: []
        };
        
        // Find high z-index elements (likely menus/dropdowns)
        const all = Array.from(document.querySelectorAll('*'));
        for (const el of all) {
          const style = window.getComputedStyle(el);
          const zIndex = parseInt(style.zIndex);
          
          if (zIndex > 100 && style.display !== 'none') {
            const text = (el.innerText || '').trim().substring(0, 200);
            result.highZIndexElements.push({
              tag: el.tagName,
              role: el.getAttribute('role') || 'none',
              zIndex: zIndex,
              text: text || '(no text)',
              ariaLabel: el.getAttribute('aria-label') || 'none'
            });
          }
        }
        
        return result;
      });
      
      console.log('   📊 After-click state:', JSON.stringify(afterClickState, null, 2));
      
      // Step 6: Wait for menu to appear with ENHANCED detection
      console.log('⏳ Step 4: Waiting for menu to appear...');
      
      let menuFound = false;
      const menuSelectors = [
        '[role="menu"]',
        '[role="listbox"]',
        '[role="dialog"]',
        'div[data-is-popup-container="true"]',
        'div[jsaction*="menu"]',
        'div[class*="menu"]',
        'ul[role="menu"]',
        'ul[role="listbox"]'
      ];
      
      for (const selector of menuSelectors) {
        try {
          await page.waitForSelector(selector, { visible: true, timeout: 2000 });
          console.log(`   ✅ Menu appeared (found with: ${selector})`);
          menuFound = true;
          break;
        } catch (e) {
          // Try next selector
        }
      }
      
      if (!menuFound) {
        console.log('   ⚠️ Menu not detected with standard selectors');
        console.log('   🔍 Checking for ANY new visible elements...');
        
        // Check if ANYTHING appeared
        const hasNewElements = afterClickState.highZIndexElements.length > 0;
        if (hasNewElements) {
          console.log(`   ℹ️ Found ${afterClickState.highZIndexElements.length} high z-index elements (likely menu)`);
        } else {
          console.log('   ⚠️ No high z-index elements found - menu may not have appeared!');
        }
      }
      
      await this.delay(2000);
      
      // Step 7: ENHANCED menu item search with 5 strategies
      console.log('🔍 Step 5: Searching for "Report review" option...');
      
      // ENHANCED: Debug what's in menus AND high z-index elements
      const menuDebug = await page.evaluate(() => {
        const result = {
          standardMenus: [],
          highZIndexAreas: [],
          allClickableText: []
        };
        
        // Check standard menu elements
        const menus = document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]');
        menus.forEach((menu, idx) => {
          const style = window.getComputedStyle(menu);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          
          if (isVisible) {
            const items = Array.from(menu.querySelectorAll('*'));
            const textItems = items
              .map(el => (el.innerText || el.textContent || '').trim())
              .filter(t => t && t.length > 0 && t.length < 100);
            
            result.standardMenus.push({
              index: idx,
              role: menu.getAttribute('role'),
              itemCount: items.length,
              textItems: textItems.slice(0, 15)
            });
          }
        });
        
        // CRITICAL: Check high z-index elements (Google might not use role="menu")
        const all = Array.from(document.querySelectorAll('*'));
        for (const el of all) {
          const style = window.getComputedStyle(el);
          const zIndex = parseInt(style.zIndex);
          
          if (zIndex > 100 && style.display !== 'none' && (style.position === 'fixed' || style.position === 'absolute')) {
            const textContent = (el.innerText || '').trim();
            if (textContent.length > 0 && textContent.length < 500) {
              result.highZIndexAreas.push({
                tag: el.tagName,
                zIndex: zIndex,
                position: style.position,
                text: textContent.substring(0, 300),
                childCount: el.children.length
              });
            }
          }
        }
        
        // Also find ALL clickable elements with "report" text
        const clickable = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], div[jsaction], span[jsaction]');
        clickable.forEach(el => {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (text.includes('report')) {
            result.allClickableText.push({
              tag: el.tagName,
              text: text.substring(0, 100),
              role: el.getAttribute('role') || 'none'
            });
          }
        });
        
        return result;
      });
      
      console.log('📋 Standard menus found:', menuDebug.standardMenus.length);
      if (menuDebug.standardMenus.length > 0) {
        console.log('   ', JSON.stringify(menuDebug.standardMenus, null, 2));
      }
      
      console.log('📋 High z-index areas found:', menuDebug.highZIndexAreas.length);
      if (menuDebug.highZIndexAreas.length > 0) {
        console.log('   ', JSON.stringify(menuDebug.highZIndexAreas.slice(0, 3), null, 2));
      }
      
      console.log('📋 Clickable elements with "report" text:', menuDebug.allClickableText.length);
      if (menuDebug.allClickableText.length > 0) {
        console.log('   ', JSON.stringify(menuDebug.allClickableText, null, 2));
      }
      
      let reportOption = null;
      
      // Strategy 1: Direct menuitemradio/menuitem search
      if (!reportOption) {
        console.log('📌 Strategy 1: Direct menuitem search...');
        reportOption = await page.evaluateHandle(() => {
          const menuItems = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
          
          for (const item of menuItems) {
            const text = (item.innerText || item.textContent || '').trim().toLowerCase();
            
            if (text.includes('report') && !text.includes('share')) {
              console.log(`   ✓ Found: "${text}"`);
              item.setAttribute('data-report-found', 'true');
              return item;
            }
          }
          return null;
        });
        
        const isValid = await reportOption.evaluate(el => el !== null);
        if (isValid) {
          const markedElement = await page.$('[data-report-found="true"]');
          if (markedElement) {
            reportOption = markedElement;
            console.log('   ✅ SUCCESS with Strategy 1');
          }
        } else {
          reportOption = null;
        }
      }
      
      // Strategy 2: Search visible elements in menu
      if (!reportOption) {
        console.log('📌 Strategy 2: Search all visible elements in menu...');
        reportOption = await page.evaluateHandle(() => {
          const menus = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"]'));
          let menuContainer = null;
          
          for (const menu of menus) {
            const style = window.getComputedStyle(menu);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              menuContainer = menu;
              break;
            }
          }
          
          if (!menuContainer) return null;
          
          const allElements = Array.from(menuContainer.querySelectorAll('div, span, button, li, a'));
          
          for (const el of allElements) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            
            if (text.length > 3 && text.length < 50 && text.includes('report')) {
              // Find clickable parent
              let clickable = el;
              let depth = 0;
              while (clickable && depth < 5) {
                const role = clickable.getAttribute('role');
                if (
                  clickable.tagName === 'BUTTON' ||
                  role === 'menuitem' ||
                  role === 'menuitemradio' ||
                  role === 'option' ||
                  clickable.getAttribute('jsaction') ||
                  window.getComputedStyle(clickable).cursor === 'pointer'
                ) {
                  clickable.setAttribute('data-report-found', 'true');
                  return clickable;
                }
                clickable = clickable.parentElement;
                depth++;
              }
            }
          }
          
          return null;
        });
        
        const isValid = await reportOption.evaluate(el => el !== null);
        if (isValid) {
          const markedElement = await page.$('[data-report-found="true"]');
          if (markedElement) {
            reportOption = markedElement;
            console.log('   ✅ SUCCESS with Strategy 2');
          }
        } else {
          reportOption = null;
        }
      }
      
      // Strategy 3: XPath search
      if (!reportOption) {
        console.log('📌 Strategy 3: XPath text search...');
        const xpaths = [
          "//div[contains(translate(., 'REPORT', 'report'), 'report')]",
          "//span[contains(translate(., 'REPORT', 'report'), 'report')]",
          "//*[contains(translate(., 'REPORT', 'report'), 'report')]"
        ];
        
        for (const xpath of xpaths) {
          try {
            const elements = await page.$x(xpath);
            if (elements.length > 0) {
              for (const el of elements) {
                const text = await page.evaluate(e => (e.innerText || e.textContent || '').trim().toLowerCase(), el);
                
                if (text.length > 3 && text.length < 50 && text.includes('report') && !text.includes('share')) {
                  await page.evaluate(e => e.setAttribute('data-report-found', 'true'), el);
                  reportOption = await page.$('[data-report-found="true"]');
                  if (reportOption) {
                    console.log(`   ✅ SUCCESS with Strategy 3: "${text}"`);
                    break;
                  }
                }
              }
              if (reportOption) break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      // Strategy 4: aria-label search
      if (!reportOption) {
        console.log('📌 Strategy 4: aria-label search...');
        reportOption = await page.evaluateHandle(() => {
          const elements = Array.from(document.querySelectorAll('[aria-label]'));
          
          for (const el of elements) {
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            if (ariaLabel.includes('report')) {
              el.setAttribute('data-report-found', 'true');
              return el;
            }
          }
          return null;
        });
        
        const isValid = await reportOption.evaluate(el => el !== null);
        if (isValid) {
          const markedElement = await page.$('[data-report-found="true"]');
          if (markedElement) {
            reportOption = markedElement;
            console.log('   ✅ SUCCESS with Strategy 4');
          }
        } else {
          reportOption = null;
        }
      }
      
      // Strategy 5: Search in high z-index elements (Google's menus)
      if (!reportOption) {
        console.log('📌 Strategy 5: Search high z-index elements...');
        reportOption = await page.evaluateHandle(() => {
          const all = Array.from(document.querySelectorAll('*'));
          
          // First, find high z-index containers
          for (const el of all) {
            const style = window.getComputedStyle(el);
            const zIndex = parseInt(style.zIndex);
            
            if (zIndex > 100 && style.display !== 'none') {
              // Search within this high z-index element for "report"
              const children = Array.from(el.querySelectorAll('*'));
              for (const child of children) {
                const childStyle = window.getComputedStyle(child);
                if (childStyle.display === 'none' || childStyle.visibility === 'hidden') continue;
                
                const text = (child.innerText || child.textContent || '').trim().toLowerCase();
                if ((text.includes('report') && text.includes('review')) || text === 'report review') {
                  child.setAttribute('data-report-found', 'true');
                  return child;
                }
              }
            }
          }
          
          return null;
        });
        
        const isValid = await reportOption.evaluate(el => el !== null);
        if (isValid) {
          const markedElement = await page.$('[data-report-found="true"]');
          if (markedElement) {
            reportOption = markedElement;
            console.log('   ✅ SUCCESS with Strategy 5');
          }
        } else {
          reportOption = null;
        }
      }
      
      // Strategy 6: Brute force all visible text
      if (!reportOption) {
        console.log('📌 Strategy 6: Brute force all text...');
        reportOption = await page.evaluateHandle(() => {
          const all = Array.from(document.querySelectorAll('*'));
          
          for (const el of all) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            
            const text = (el.innerText || '').trim().toLowerCase();
            
            if (text === 'report review' || text === 'report' || text === 'flag review') {
              el.setAttribute('data-report-found', 'true');
              return el;
            }
          }
          
          return null;
        });
        
        const isValid = await reportOption.evaluate(el => el !== null);
        if (isValid) {
          const markedElement = await page.$('[data-report-found="true"]');
          if (markedElement) {
            reportOption = markedElement;
            console.log('   ✅ SUCCESS with Strategy 5');
          }
        } else {
          reportOption = null;
        }
      }
      
      if (!reportOption) {
        // Final diagnostic
        console.log('❌ ALL STRATEGIES FAILED');
        
        const allVisibleText = await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll('*'));
          const visible = [];
          
          for (const el of all) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              const text = (el.innerText || el.textContent || '').trim();
              if (text && text.length > 0 && text.length < 100) {
                visible.push({
                  tag: el.tagName,
                  text: text,
                  role: el.getAttribute('role') || '',
                  aria: el.getAttribute('aria-label') || ''
                });
              }
            }
          }
          
          return visible.slice(0, 50);
        });
        
        console.log('📋 All visible elements:', JSON.stringify(allVisibleText, null, 2));
        
        try {
          await page.screenshot({ path: '/tmp/report-menu-not-found.png', fullPage: false });
          console.log('📸 Screenshot saved: /tmp/report-menu-not-found.png');
        } catch (e) {}
        
        throw new Error('Could not find "Report review" option after trying all strategies');
      }
      
      // Step 8: Click report option
      console.log('🖱️ Step 6: Clicking "Report review" option...');
      
      // DIAGNOSTIC: Screenshot before click
      try {
        await page.screenshot({ path: '/tmp/before-report-click.png', fullPage: false });
        console.log('   📸 Before click screenshot: /tmp/before-report-click.png');
      } catch (e) {}
      
      // ENHANCED: Try multiple click strategies for report option
      let reportClickSuccess = false;
      
      // Strategy 1: JavaScript click (NON-BLOCKING - critical fix!)
      // CRITICAL: Puppeteer's .click() waits for navigation by default
      // When clicking opens a dialog (no navigation), it hangs forever
      // Using page.evaluate with click() doesn't wait for navigation
      try {
        console.log('   🖱️ Trying: JavaScript click (non-blocking)...');
        await page.evaluate(el => el.click(), reportOption);
        console.log('   ✅ JavaScript click executed');
        reportClickSuccess = true;
      } catch (e) {
        console.log('   ⚠️ JavaScript click failed:', e.message);
      }
      
      // Strategy 2: Dispatch MouseEvent (if JS click failed)
      if (!reportClickSuccess) {
        try {
          console.log('   🖱️ Trying: MouseEvent dispatch...');
          await page.evaluate(el => {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }, reportOption);
          console.log('   ✅ MouseEvent dispatch executed');
          reportClickSuccess = true;
        } catch (e) {
          console.log('   ⚠️ MouseEvent dispatch failed:', e.message);
        }
      }
      
      // Strategy 3: Dispatch click event
      if (!reportClickSuccess) {
        try {
          console.log('   🖱️ Trying: Dispatch click event...');
          await reportOption.evaluate(el => {
            el.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            }));
          });
          console.log('   ✅ Dispatch click executed');
          reportClickSuccess = true;
        } catch (e) {
          console.log('   ⚠️ Dispatch click failed:', e.message);
        }
      }
      
      if (!reportClickSuccess) {
        throw new Error('All click strategies failed for "Report review" option');
      }
      
      // DIAGNOSTIC: Wait and screenshot after click
      await this.delay(3000);
      
      try {
        await page.screenshot({ path: '/tmp/after-report-click.png', fullPage: false });
        console.log('   📸 After click screenshot: /tmp/after-report-click.png');
      } catch (e) {}
      
      // DIAGNOSTIC: Check what's on page after click (with timeout protection)
      console.log('   🔍 Checking page state after click...');
      let pageState = null;
      try {
        pageState = await Promise.race([
          page.evaluate(() => {
            const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
            const captchaElements = document.querySelectorAll('[id*="captcha"], [class*="captcha"], [id*="recaptcha"], iframe[src*="recaptcha"]');
            const loadingElements = document.querySelectorAll('[aria-busy="true"], [role="progressbar"], .loading, [class*="spinner"]');
            
            return {
              dialogCount: dialogs.length,
              captchaCount: captchaElements.length,
              loadingCount: loadingElements.length,
              url: window.location.href,
              title: document.title,
              bodyText: document.body.innerText.substring(0, 500)
            };
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Page state check timeout')), 5000))
        ]);
        
        console.log('   📊 Page state:', JSON.stringify(pageState, null, 2));
        
        // Check for CAPTCHA
        if (pageState.captchaCount > 0) {
          console.log('   🚨 CAPTCHA DETECTED! Need to solve CAPTCHA first');
          throw new Error('CAPTCHA appeared after clicking Report review - automated reporting blocked');
        }
        
        // Check for loading state
        if (pageState.loadingCount > 0) {
          console.log('   ⏳ Page is loading, waiting 5 more seconds...');
          await this.delay(5000);
        }
      } catch (e) {
        console.log('   ⚠️ Page state check failed or timed out:', e.message);
        console.log('   ℹ️ Continuing anyway - dialog search will proceed');
      }
      
      // Step 9: Wait for report dialog
      console.log('⏳ Step 7: Waiting for report dialog...');
      
      let dialogFound = false;
      
      try {
        await page.waitForSelector('[role="dialog"], [role="alertdialog"]', {
          visible: true,
          timeout: 30000  // Increased from 10s to 30s
        });
        console.log('   ✅ Report dialog opened');
        dialogFound = true;
      } catch (e) {
        console.log('   ⚠️ Dialog selector timeout after 30s');
      }
      
      // DIAGNOSTIC: If dialog not found, do deep investigation
      if (!dialogFound) {
        console.log('   🔍 Dialog not found - performing deep investigation...');
        
        // Check all possible dialog-like elements
        const dialogInvestigation = await page.evaluate(() => {
          const results = {
            roleDialog: document.querySelectorAll('[role="dialog"]').length,
            roleAlertDialog: document.querySelectorAll('[role="alertdialog"]').length,
            ariaModal: document.querySelectorAll('[aria-modal="true"]').length,
            divDialogs: document.querySelectorAll('div[role="dialog"], div[role="alertdialog"]').length,
            allDivs: document.querySelectorAll('div').length,
            recentlyAdded: [],
            allVisible: []
          };
          
          // Find recently added elements (likely candidates for dialog)
          const allElements = Array.from(document.querySelectorAll('*'));
          for (const el of allElements) {
            const zIndex = window.getComputedStyle(el).zIndex;
            const position = window.getComputedStyle(el).position;
            const display = window.getComputedStyle(el).display;
            
            if ((zIndex && parseInt(zIndex) > 100) || position === 'fixed' || position === 'absolute') {
              const text = (el.innerText || '').trim().substring(0, 200);
              if (text) {
                results.allVisible.push({
                  tag: el.tagName,
                  role: el.getAttribute('role') || 'none',
                  zIndex: zIndex,
                  position: position,
                  display: display,
                  text: text
                });
              }
            }
          }
          
          return results;
        });
        
        console.log('   📊 Dialog investigation:', JSON.stringify(dialogInvestigation, null, 2));
        
        // Screenshot for debugging
        try {
          await page.screenshot({ path: '/tmp/dialog-not-found.png', fullPage: true });
          console.log('   📸 Full page screenshot: /tmp/dialog-not-found.png');
        } catch (e) {}
        
        throw new Error('Report dialog did not appear after clicking "Report review". Check screenshots for details.');
      }
      
      await this.delay(2000);
      
      // Step 10: Select report reason
      console.log(`🎯 Step 8: Selecting report reason: "${reason}"...`);
      
      // ENHANCED: Wait longer for dialog to appear and stabilize
      console.log('   ⏳ Waiting for dialog to stabilize (5 more seconds)...');
      await this.delay(5000);
      
      // ENHANCED: Verify dialog exists before proceeding
      const dialogExists = await page.evaluate(() => {
        const allDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        console.log(`   📊 Found ${allDialogs.length} dialogs on page`);
        return allDialogs.length > 0;
      });
      
      if (!dialogExists) {
        console.log('   ❌ No dialog found after waiting - taking diagnostic screenshot');
        try {
          await page.screenshot({ path: '/tmp/no-dialog-found.png', fullPage: false });
          console.log('   📸 Screenshot saved: /tmp/no-dialog-found.png');
        } catch (e) {}
        
        // Try one more time with extra wait
        console.log('   🔄 Attempting recovery: waiting 10 more seconds...');
        await this.delay(10000);
        
        const dialogExistsRetry = await page.evaluate(() => {
          const allDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
          return allDialogs.length > 0;
        });
        
        if (!dialogExistsRetry) {
          throw new Error('Report dialog never appeared after clicking "Report review"');
        }
        
        console.log('   ✅ Dialog appeared after extended wait');
      } else {
        console.log('   ✅ Dialog confirmed on page');
      }
      
      let reasonClicked = false;
      
      // Try to find and click the reason
      const exactTextResult = await page.evaluate((reason) => {
        const allDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        let reportDialog = allDialogs.length > 0 ? allDialogs[allDialogs.length - 1] : null;
        
        if (!reportDialog) {
          console.log('   ⚠️ No dialog in DOM (this should not happen)');
          return { success: false };
        }
        
        console.log('   🔍 Searching for reason in dialog...');
        
        const allElements = Array.from(reportDialog.querySelectorAll('*'));
        for (const el of allElements) {
          const text = (el.innerText || el.textContent || '').trim();
          if (text === reason) {
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
                return { success: true, method: 'exact-text' };
              }
              clickable = clickable.parentElement;
              depth++;
            }
          }
        }
        return { success: false };
      }, reason);
      
      if (exactTextResult.success) {
        console.log(`   ✅ Report reason selected: ${reason}`);
        reasonClicked = true;
      }
      
      if (!reasonClicked) {
        // ENHANCED: Show what's actually in the dialog
        console.log('   ❌ Could not find report reason - showing dialog contents');
        
        const dialogContent = await page.evaluate(() => {
          const allDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
          const reportDialog = allDialogs.length > 0 ? allDialogs[allDialogs.length - 1] : null;
          
          if (!reportDialog) return { error: 'No dialog found' };
          
          const allText = Array.from(reportDialog.querySelectorAll('*'))
            .map(el => (el.innerText || el.textContent || '').trim())
            .filter(text => text.length > 0 && text.length < 200)
            .slice(0, 30);
          
          return {
            dialogHTML: reportDialog.innerHTML.substring(0, 1000),
            allText: allText
          };
        });
        
        console.log('   📋 Dialog contents:', JSON.stringify(dialogContent, null, 2));
        
        try {
          await page.screenshot({ path: '/tmp/reason-not-found.png', fullPage: false });
          console.log('   📸 Screenshot saved: /tmp/reason-not-found.png');
        } catch (e) {}
        
        throw new Error(`Could not select report reason: ${reason}. Dialog might not have loaded properly or reason text doesn't match.`);
      }
      
      await this.delay(2000);
      
      // Step 11: Submit report
      console.log('📤 Step 9: Submitting report...');
      
      const submitClicked = await page.evaluate(() => {
        const submitButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
        
        for (const btn of submitButtons) {
          const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          
          if (text === 'submit' || text === 'send' || ariaLabel.includes('submit') || ariaLabel.includes('send')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (!submitClicked) {
        throw new Error('Could not find submit button');
      }
      
      console.log('   ✅ Submit button clicked');
      await this.delay(3000);
      
      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ REVIEW REPORTED SUCCESSFULLY');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      
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
    this.currentReview = review;
    let page = null;
    let gmailAccount = null;
    let proxyIp = null;

    try {
      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🔄 Processing review:', review.id);
      console.log('   Business:', review.business_name);
      console.log('═══════════════════════════════════════════════════════════');

      // Get proxy configuration
      const proxyConfig = await this.getNextProxyConfig();
      
      // Initialize browser with proxy
      if (!this.browser) {
        await this.initBrowser(proxyConfig);
      }

      // Get available Gmail account
      gmailAccount = await this.getNextGmailAccount();
      console.log(`📧 Using Gmail account: ${gmailAccount.email}`);

      // Create new page
      page = await this.browser.newPage();
      
      // Set page timeouts (increase from default 30s to 90s)
      page.setDefaultNavigationTimeout(90000);  // 90 seconds for navigation
      page.setDefaultTimeout(90000);  // 90 seconds for other operations

      // Detect proxy IP
      if (proxyConfig) {
        console.log('🌐 Detecting proxy IP address...');
        try {
          await page.goto('https://api.ipify.org?format=json', { timeout: 60000 });
          const ipData = await page.evaluate(() => document.body.textContent);
          proxyIp = JSON.parse(ipData).ip;
          console.log(`✅ Connected via proxy IP: ${proxyIp}`);
        } catch (e) {
          console.log('⚠️ Could not detect proxy IP');
        }
      }

      // Authenticate with proxy if credentials available
      if (this.proxyCredentials) {
        console.log(`🔐 Authenticating with proxy...`);
        await page.authenticate(this.proxyCredentials);
        console.log(`✅ Proxy authentication configured`);
      }

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Update review status
      await this.updateReviewStatus(review.id, 'in_progress', gmailAccount.id);

      // OAuth Gmail Authentication
      console.log('🔐 Authenticating Gmail account with OAuth...');
      const oauthResult = await oauthHandler.verifyGmailAccount(gmailAccount.email);
      
      if (!oauthResult.success) {
        console.error(`❌ OAuth authentication failed: ${oauthResult.error}`);
        throw new Error(`Gmail OAuth verification failed: ${oauthResult.error}`);
      }
      
      console.log(`✅ Gmail OAuth authentication successful for: ${gmailAccount.email}`);

      // Extract review text if needed
      let reviewText = review.review_text || '';
      
      if (!reviewText || reviewText.length < 10) {
        console.log('📝 Review text not in database - extracting...');
        
        console.log(`🗺️ Opening review link: ${review.review_link}`);
        try {
          await page.goto(review.review_link, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
          });
          await this.delay(5000);
          
          const reviewData = await this.extractReviewText(page);
          
          if (reviewData.reviewText && reviewData.reviewText.length >= 10) {
            console.log(`💾 Saving extracted review text (${reviewData.reviewText.length} chars)...`);
            
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
              reviewText = reviewData.reviewText;
            }
          }
        } catch (extractError) {
          console.error('⚠️ Error extracting review text:', extractError.message);
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

      // Update review status to completed
      await this.updateReviewStatus(review.id, 'completed', gmailAccount.id);

      // Update Gmail account last_used
      await this.updateGmailLastUsed(gmailAccount.id);

      // Log activity
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

      // Update review status
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
          // Ignore
        }
      }
    } finally {
      this.currentReview = null;
    }
  }

  /**
   * Delay helper
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
   * Start automation service
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
    
    this.pollForReviews();
    
    console.log('✅ Automation service started successfully');
  }

  /**
   * Stop automation service
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ Automation is not running');
      return;
    }

    console.log('🛑 Stopping automation service...');
    
    this.isRunning = false;
    
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = null;
    }

    await this.closeBrowser();
    
    console.log('✅ Automation service stopped');
  }
}

// Export the class
module.exports = AutomationService;
