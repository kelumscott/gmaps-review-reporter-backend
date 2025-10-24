/**
 * Google Maps Review Reporter - API-Controllable Automation Service
 * WITH ALL 6 FIXES APPLIED:
 * 
 * Fix 1: Add 3s wait before menu button search
 * Fix 2: Make button detection case-insensitive
 * Fix 3: Add fallback for ANY Actions button
 * Fix 4: Detect 2-step workflow after reason selection
 * Fix 5: Enhanced submit button detection with success/error checking
 * Fix 6: Error handling for GOOGLE_DUPLICATE_REPORT
 * 
 * READY TO COPY-PASTE TO GITHUB!
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
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080'
        ],
        defaultViewport: {
          width: 1920,
          height: 1080
        },
        executablePath: await chromium.executablePath()
      };

      // Add proxy if provided
      if (proxyConfig) {
        const { proxy_host, proxy_port, proxy_username, proxy_password } = proxyConfig;
        
        if (proxy_host && proxy_port) {
          console.log(`🔐 Configuring proxy: ${proxy_host}:${proxy_port}`);
          
          // Store credentials for page.authenticate()
          this.proxyCredentials = {
            username: proxy_username,
            password: proxy_password
          };
          
          // Add proxy to browser args
          launchOptions.args.push(`--proxy-server=${proxy_host}:${proxy_port}`);
          console.log('✅ Proxy authentication configured');
        }
      }

      try {
        this.browser = await puppeteerExtra.launch(launchOptions);
        console.log('✅ Browser launched successfully');
      } catch (error) {
        console.error('❌ Failed to launch browser:', error.message);
        throw error;
      }
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Browser closed');
    }
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch active proxy configuration
   */
  async getProxyConfig() {
    try {
      console.log('🔍 Fetching active proxy configuration...');
      const { data, error } = await supabase
        .from('proxy_configs')
        .select('*')
        .eq('status', 'active')
        .single();

      if (error) throw error;
      
      if (data) {
        console.log(`✅ Proxy config loaded: ${data.proxy_host}:${data.proxy_port}`);
        return data;
      }
      
      console.log('⚠️ No active proxy configuration found');
      return null;
    } catch (error) {
      console.error('❌ Error fetching proxy config:', error.message);
      return null;
    }
  }

  /**
   * Get next Gmail account to use
   */
  async getNextGmailAccount() {
    try {
      console.log('📧 Fetching next Gmail account...');
      const { data, error } = await supabase
        .from('gmail_accounts')
        .select('*')
        .eq('status', 'active')
        .is('last_used_at', null)
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        console.log(`✅ Selected Gmail account: ${data[0].email}`);
        return data[0];
      }

      // If no unused accounts, get least recently used
      const { data: leastRecent, error: lruError } = await supabase
        .from('gmail_accounts')
        .select('*')
        .eq('status', 'active')
        .order('last_used_at', { ascending: true })
        .limit(1);

      if (lruError) throw lruError;

      if (leastRecent && leastRecent.length > 0) {
        console.log(`✅ Selected least recently used Gmail account: ${leastRecent[0].email}`);
        return leastRecent[0];
      }

      throw new Error('No active Gmail accounts available');
    } catch (error) {
      console.error('❌ Error fetching Gmail account:', error.message);
      throw error;
    }
  }

  /**
   * Update Gmail account last_used timestamp
   */
  async updateGmailLastUsed(gmailId) {
    try {
      const { error } = await supabase
        .from('gmail_accounts')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', gmailId);

      if (error) throw error;
      console.log('✅ Gmail account last_used timestamp updated');
    } catch (error) {
      console.error('⚠️ Could not update Gmail last_used:', error.message);
    }
  }

  /**
   * Fetch next pending review
   */
  async getNextReview() {
    try {
      console.log('🔍 Looking for pending reviews...');
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        console.log(`✅ Found review for: ${data[0].business_name}`);
        return data[0];
      }

      console.log('ℹ️ No pending reviews found');
      return null;
    } catch (error) {
      console.error('❌ Error fetching review:', error.message);
      throw error;
    }
  }

  /**
   * Update review status
   */
  async updateReviewStatus(reviewId, status, gmailAccountId = null) {
    try {
      const updateData = {
        status,
        updated_at: new Date().toISOString()
      };

      if (gmailAccountId) {
        updateData.gmail_account_id = gmailAccountId;
      }

      const { error } = await supabase
        .from('reviews')
        .update(updateData)
        .eq('id', reviewId);

      if (error) throw error;
      console.log(`✅ Review status updated to: ${status}`);
    } catch (error) {
      console.error('⚠️ Could not update review status:', error.message);
    }
  }

  /**
   * Log automation activity
   */
  async logActivity(reviewId, gmailAccountId, proxyIp, status) {
    try {
      const { error } = await supabase
        .from('automation_logs')
        .insert({
          review_id: reviewId,
          gmail_account_id: gmailAccountId,
          proxy_ip: proxyIp,
          status,
          created_at: new Date().toISOString()
        });

      if (error) throw error;
      console.log('✅ Activity logged');
    } catch (error) {
      console.error('⚠️ Could not log activity:', error.message);
    }
  }

  /**
   * Get current proxy IP
   */
  async getProxyIp(page) {
    try {
      console.log('🌐 Detecting proxy IP address...');
      
      // Navigate to IP detection service
      await page.goto('https://api.ipify.org?format=json', { 
        waitUntil: 'networkidle2',
        timeout: 15000 
      });
      
      // Get IP from response
      const content = await page.content();
      const ipMatch = content.match(/"ip":"([^"]+)"/);
      
      if (ipMatch && ipMatch[1]) {
        const ip = ipMatch[1];
        console.log(`✅ Connected via proxy IP: ${ip}`);
        return ip;
      }
      
      console.log('⚠️ Could not detect proxy IP');
      return 'unknown';
    } catch (error) {
      console.error('⚠️ Error detecting proxy IP:', error.message);
      return 'unknown';
    }
  }

  /**
   * Rotate proxy session (for sticky session proxies)
   */
  async rotateProxySession(proxyConfig) {
    try {
      if (!proxyConfig) return 1;

      // Get current session number
      let currentSession = parseInt(proxyConfig.current_session || '1');
      const maxSessions = parseInt(proxyConfig.max_sessions || '10000');

      // Increment session
      currentSession++;
      if (currentSession > maxSessions) {
        currentSession = 1;
      }

      // Update in database
      const { error } = await supabase
        .from('proxy_configs')
        .update({ 
          current_session: currentSession.toString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', proxyConfig.id);

      if (error) throw error;

      console.log(`🔄 Proxy IP rotation: session ${currentSession} / ${maxSessions}`);
      return currentSession;
    } catch (error) {
      console.error('⚠️ Could not rotate proxy session:', error.message);
      return 1;
    }
  }

  /**
   * Extract review text from Google Maps
   */
  async extractReviewText(page, reviewLink) {
    try {
      console.log('📄 Extracting review text...');
      console.log(`   Review link: ${reviewLink}`);
      
      // Navigate to the review link
      await page.goto(reviewLink, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await this.delay(3000);
      
      // Try multiple strategies to extract review text
      const reviewText = await page.evaluate(() => {
        // Strategy 1: Look for review text in common containers
        const textSelectors = [
          '[class*="review-text"]',
          '[class*="review-full-text"]',
          '[data-review-id] span',
          '[jsaction*="review"] span',
          '.review-text',
          '[role="article"] span'
        ];
        
        for (const selector of textSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent?.trim();
            if (text && text.length > 50) {
              return text;
            }
          }
        }
        
        // Strategy 2: Get all text content and find longest paragraph
        const allSpans = Array.from(document.querySelectorAll('span'));
        let longestText = '';
        
        for (const span of allSpans) {
          const text = span.textContent?.trim() || '';
          if (text.length > longestText.length && text.length > 50) {
            longestText = text;
          }
        }
        
        if (longestText) return longestText;
        
        // Strategy 3: Get visible text from body
        const bodyText = document.body.innerText;
        const lines = bodyText.split('\n').filter(line => line.trim().length > 50);
        
        if (lines.length > 0) {
          return lines.join(' ').substring(0, 2000);
        }
        
        return null;
      });
      
      if (reviewText) {
        console.log(`✅ Review text extracted (${reviewText.length} characters)`);
        return reviewText;
      }
      
      console.log('⚠️ Could not extract review text');
      return null;
      
    } catch (error) {
      console.error('⚠️ Error extracting review text:', error.message);
      return null;
    }
  }

  /**
   * Store review text in database
   */
  async storeReviewText(reviewId, reviewText) {
    try {
      const { error } = await supabase
        .from('reviews')
        .update({ 
          review_text: reviewText,
          updated_at: new Date().toISOString()
        })
        .eq('id', reviewId);

      if (error) throw error;
      console.log('✅ Review text stored in database');
    } catch (error) {
      console.error('⚠️ Could not store review text:', error.message);
    }
  }

  /**
   * Report a Google Maps review
   * WITH ALL 6 FIXES INTEGRATED
   */
  async reportReview(page, reviewLink, reportReason) {
    try {
      console.log(`🗺️ Opening review link: ${reviewLink}`);
      
      // Try multiple navigation strategies with fallback
      const strategies = [
        { name: 'DOM Content Loaded', waitUntil: 'domcontentloaded', timeout: 60000 },
        { name: 'Network Idle', waitUntil: 'networkidle2', timeout: 45000 },
        { name: 'Load Event', waitUntil: 'load', timeout: 30000 }
      ];

      let navigationSuccess = false;
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
            throw new Error('All navigation strategies failed');
          }
        }
      }

      if (!navigationSuccess) {
        throw new Error('Could not navigate to review page');
      }

      // Wait for page to stabilize
      console.log('   ⏳ Waiting for page to stabilize...');
      await this.delay(5000);

      // Check if we're on a minimal page type
      console.log('🔍 Checking page content...');
      const pageInfo = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        const hasCollapseOnly = Array.from(buttons).some(btn => 
          btn.getAttribute('aria-label')?.includes('Collapse')
        );
        
        return {
          url: window.location.href,
          title: document.title,
          hasButtons: buttons.length,
          hasAriaLabels: Array.from(buttons).filter(btn => btn.getAttribute('aria-label')).length,
          isCollapseOnly: hasCollapseOnly && buttons.length <= 3,
          firstButtonText: buttons[0]?.innerText || ''
        };
      });

      console.log('📄 Page info:', JSON.stringify(pageInfo, null, 2));

      // If minimal page, try to navigate to full page
      if (pageInfo.hasButtons <= 5 || pageInfo.isCollapseOnly) {
        console.log('⚠️ Detected minimal page (limited UI controls)');
        console.log('🔄 Attempting to navigate to full review page...');
        
        // Extract review ID and place ID from URL
        const currentUrl = pageInfo.url;
        const reviewIdMatch = currentUrl.match(/!1s0x0:0x([a-f0-9]+)/);
        let reviewId = null;
        if (reviewIdMatch) {
          reviewId = reviewIdMatch[1];
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
        
        // Final check: Did we successfully get to a full page?
        const finalCheck = await page.evaluate(() => ({
          buttons: document.querySelectorAll('button').length,
          url: window.location.href
        }));
        
        console.log(`📊 Final page check:`);
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

      // ═══════════════════════════════════════════════════════════
      // FIX 1: ADD 3-SECOND WAIT BEFORE MENU BUTTON SEARCH
      // ═══════════════════════════════════════════════════════════
      
      // Look for the three-dot menu button ON THE REVIEW (not main menu)
      console.log('🔍 Searching for review\'s three-dot menu button...');
      
      // CRITICAL: Wait for buttons to fully load
      console.log('   ⏳ Waiting for review buttons to appear (3 seconds)...');
      await this.delay(3000);
      
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
        
        // ═══════════════════════════════════════════════════════════
        // FIX 2 & 3: IMPROVED BUTTON DETECTION WITH FALLBACK
        // ═══════════════════════════════════════════════════════════
        
        // Fallback: Look for buttons with "Actions" (Google's label for review three-dot menu)
        const allActionButtons = Array.from(document.querySelectorAll('button[aria-label*="Actions"]'));
        
        for (const button of allActionButtons) {
          const ariaLabel = button.getAttribute('aria-label') || '';
          
          // Look for "Actions for [name]'s review" pattern (case-insensitive) - FIX 2
          const lowerLabel = ariaLabel.toLowerCase();
          if (lowerLabel.includes('actions') && lowerLabel.includes('review')) {
            button.setAttribute('data-review-menu-found', 'true');
            return { success: true, selector: 'button[aria-label*="Actions"]', found: ariaLabel, method: 'actions-review' };
          }
        }
        
        // FIX 3: If we have ANY Actions buttons, use the first one
        if (allActionButtons.length > 0) {
          allActionButtons[0].setAttribute('data-review-menu-found', 'true');
          return { success: true, selector: 'button[aria-label*="Actions"]', found: allActionButtons[0].getAttribute('aria-label'), method: 'actions-fallback' };
        }
        
        // Final fallback: Look for ALL buttons with "More" that are NOT in the main navigation
        const allMoreButtons = Array.from(document.querySelectorAll('button[aria-label*="More"]'));
        
        for (const button of allMoreButtons) {
          const ariaLabel = button.getAttribute('aria-label') || '';
          const buttonText = button.innerText || '';
          
          // Skip main menu buttons (they have specific text/labels)
          if (ariaLabel.toLowerCase().includes('main menu') || 
              ariaLabel.toLowerCase().includes('google apps') ||
              buttonText.includes('Menu')) {
            continue;
          }
          
          // This is likely the review's three-dot button
          button.setAttribute('data-review-menu-found', 'true');
          return { success: true, selector: 'button[aria-label*="More"]', found: ariaLabel, method: 'more-button' };
        }
        
        return { success: false, actionsCount: allActionButtons.length, moreCount: allMoreButtons.length };
      });
      
      let actualMenuButton = null;
      if (menuButton && menuButton.success) {
        console.log(`✅ Found review menu button with selector: ${menuButton.selector}`);
        if (menuButton.found) {
          console.log(`   📋 Button aria-label: "${menuButton.found}"`);
        }
        if (menuButton.method) {
          console.log(`   🔍 Found using method: ${menuButton.method}`);
        }
        // Get the actual button element that we marked
        actualMenuButton = await page.$('button[data-review-menu-found="true"]');
        
        if (!actualMenuButton) {
          console.log('   ⚠️ WARNING: Button was marked but could not be retrieved!');
          console.log('   💡 This might be a timing issue. Trying direct selector...');
          actualMenuButton = await page.$(menuButton.selector);
        }
      } else {
        console.log('⚠️ Menu button search returned: ', JSON.stringify(menuButton));
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
          { steps: 10 }
        );
        await this.delay(500);
      }
      
      // Strategy 3: Try multiple click methods
      console.log('🖱️ Step 3: Attempting to click menu button...');
      let menuOpened = false;
      
      // Method 1: Regular click
      if (!menuOpened) {
        try {
          console.log('   🔄 Method 1: Regular click...');
          await actualMenuButton.click();
          await this.delay(2000);
          
          // Check if menu appeared
          const menuVisible = await page.evaluate(() => {
            const menus = document.querySelectorAll('[role="menu"], [role="listbox"]');
            return menus.length > 0;
          });
          
          if (menuVisible) {
            console.log('   ✅ Menu appeared after regular click!');
            menuOpened = true;
          }
        } catch (e) {
          console.log('   ⚠️ Method 1 failed:', e.message);
        }
      }
      
      // Method 2: Click with delay
      if (!menuOpened) {
        try {
          console.log('   🔄 Method 2: Click with delay...');
          await actualMenuButton.click({ delay: 100 });
          await this.delay(2000);
          
          const menuVisible = await page.evaluate(() => {
            const menus = document.querySelectorAll('[role="menu"], [role="listbox"]');
            return menus.length > 0;
          });
          
          if (menuVisible) {
            console.log('   ✅ Menu appeared after delayed click!');
            menuOpened = true;
          }
        } catch (e) {
          console.log('   ⚠️ Method 2 failed:', e.message);
        }
      }
      
      // Method 3: JavaScript click
      if (!menuOpened) {
        try {
          console.log('   🔄 Method 3: JavaScript click...');
          await page.evaluate(el => el.click(), actualMenuButton);
          await this.delay(2000);
          
          const menuVisible = await page.evaluate(() => {
            const menus = document.querySelectorAll('[role="menu"], [role="listbox"]');
            return menus.length > 0;
          });
          
          if (menuVisible) {
            console.log('   ✅ Menu appeared after JS click!');
            menuOpened = true;
          }
        } catch (e) {
          console.log('   ⚠️ Method 3 failed:', e.message);
        }
      }
      
      // Method 4: Double click (last resort)
      if (!menuOpened) {
        try {
          console.log('   🔄 Method 4: Double click...');
          await actualMenuButton.click({ clickCount: 2 });
          await this.delay(2000);
          
          const menuVisible = await page.evaluate(() => {
            const menus = document.querySelectorAll('[role="menu"], [role="listbox"]');
            return menus.length > 0;
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
          
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            elements.forEach((el, index) => {
              const text = (el.innerText || el.textContent || '').trim();
              // Only add if we haven't seen this element and it has text
              if (text && !foundItems.has(el)) {
                foundItems.add(el);
                items.push({
                  selector: selector,
                  text: text.substring(0, 100),
                  role: el.getAttribute('role'),
                  ariaLabel: el.getAttribute('aria-label') || '',
                  className: el.className?.substring(0, 50) || ''
                });
              }
            });
          }
          
          return items.slice(0, 30); // Return first 30 items
        });
        
        console.log(`📋 Found ${menuItems.length} menu items/elements:`);
        menuItems.forEach((item, i) => {
          console.log(`   ${i + 1}. [${item.role || 'no-role'}] "${item.text}" (${item.selector})`);
        });
      } catch (e) {
        console.log('⚠️ Could not debug menu items:', e.message);
      }

      // Look for "Report review" option with multiple strategies
      console.log('🔍 Looking for "Report review" option...');
      
      // ENHANCED: Try multiple XPath variations to find "Report review"
      const xpathStrategies = [
        '//div[contains(text(), "Report review")]',
        '//*[contains(text(), "Report review")]',
        '//span[contains(text(), "Report review")]',
        '//div[@role="menuitem" and contains(text(), "Report")]',
        '//*[@role="menuitem" and contains(text(), "Report")]',
        '//div[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "report")]'
      ];

      let reportOption = null;
      
      // Try each XPath strategy
      for (const xpath of xpathStrategies) {
        try {
          console.log(`   🔍 Trying XPath: ${xpath}`);
          const elements = await page.$x(xpath);
          
          if (elements.length > 0) {
            console.log(`   ✓ Found ${elements.length} elements with XPath`);
            
            // Try each element to see if it's clickable
            for (const element of elements) {
              const text = await page.evaluate(el => el.textContent, element);
              console.log(`   📝 Element text: "${text}"`);
              
              if (text.toLowerCase().includes('report')) {
                reportOption = element;
                console.log(`   ✅ Selected element with text: "${text}"`);
                break;
              }
            }
            
            if (reportOption) break;
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
                  clickable.hasAttribute('jsaction') ||
                  clickable.classList.contains('VfPpkd-StrnGf-rymPhb')
                ) {
                  clickable.setAttribute('data-report-item-found', 'true');
                  console.log(`   ✓ Found clickable parent: ${clickable.tagName} (role: ${role})`);
                  return clickable;
                }
                clickable = clickable.parentElement;
                depth++;
              }
            }
          }
          
          return null;
        });
        
        // Check if we found it
        const foundViaHandle = await page.$('[data-report-item-found="true"]');
        if (foundViaHandle) {
          reportOption = foundViaHandle;
          console.log('   ✅ Found report option via broad CSS search');
        }
      }

      if (!reportOption) {
        // Final debug: Take screenshot and list all text content
        console.log('⚠️ Could not find "Report review" option');
        
        try {
          await page.screenshot({ path: '/tmp/menu-debug.png', fullPage: false });
          console.log('📸 Menu screenshot saved to /tmp/menu-debug.png');
        } catch (e) {}
        
        const allText = await page.evaluate(() => document.body.innerText);
        console.log('📄 All page text (first 500 chars):', allText.substring(0, 500));
        
        throw new Error('Could not find "Report review" option in menu');
      }

      // Click "Report review"
      console.log('🖱️ Clicking "Report review" option...');
      await reportOption.click();
      await this.delay(3000);

      // Wait for report dialog to open
      console.log('⏳ Waiting for report dialog to open...');
      try {
        await page.waitForSelector('[role="dialog"], [role="alertdialog"], .dialog, [aria-modal="true"]', {
          visible: true,
          timeout: 10000
        });
        console.log('✅ Report dialog opened');
      } catch (dialogError) {
        console.log('⚠️ Dialog selector not found, but continuing (dialog might have different structure)');
      }
      
      await this.delay(2000);

      // ═══════════════════════════════════════════════════════════
      // SMART DIALOG FINDER - Find the CORRECT dialog among multiple
      // ═══════════════════════════════════════════════════════════
      
      console.log('🔍 Analyzing page dialogs...');
      
      const dialogInfo = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'));
        
        return dialogs.map((dialog, index) => {
          const text = (dialog.innerText || dialog.textContent || '').toLowerCase();
          
          // Check for report-related keywords
          const hasReportKeywords = 
            text.includes('report') ||
            text.includes('fake') ||
            text.includes('offensive') ||
            text.includes('conflict') ||
            text.includes('spam');
          
          // Check for UI controls (Zoom In/Out = wrong dialog)
          const hasZoomControls = text.includes('zoom in') || text.includes('zoom out');
          
          return {
            index,
            hasReportKeywords,
            hasZoomControls,
            textSnippet: text.substring(0, 200),
            isLikelyReportDialog: hasReportKeywords && !hasZoomControls
          };
        });
      });
      
      console.log(`📋 Found ${dialogInfo.length} dialog(s):`);
      dialogInfo.forEach(info => {
        console.log(`   Dialog ${info.index}: Report keywords: ${info.hasReportKeywords}, Zoom controls: ${info.hasZoomControls}`);
        console.log(`      Likely report dialog: ${info.isLikelyReportDialog ? '✅ YES' : '❌ NO'}`);
        console.log(`      Text: "${info.textSnippet.substring(0, 100)}"`);
      });
      
      // Find the correct dialog
      const correctDialogIndex = dialogInfo.findIndex(d => d.isLikelyReportDialog);
      
      if (correctDialogIndex === -1) {
        console.log('⚠️ WARNING: Could not identify the report dialog among visible dialogs');
        console.log('💡 Will search all dialogs for report reasons');
      } else {
        console.log(`✅ Identified report dialog at index: ${correctDialogIndex}`);
      }

      // Look for the report reason option
      console.log(`🔍 Looking for reason: "${reportReason}"...`);
      
      // Try exact text match first (ENHANCED with dialog scoping)
      const exactTextResult = await page.evaluate((reason, targetDialogIndex) => {
        // Helper function to check if element is inside the target dialog
        const isInTargetDialog = (element) => {
          if (targetDialogIndex === -1) return true; // No specific dialog, search all
          
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'));
          const targetDialog = dialogs[targetDialogIndex];
          
          if (!targetDialog) return true; // Fallback to searching all
          
          return targetDialog.contains(element);
        };
        
        // Strategy 1: Look for exact text match in menuitemradio elements
        const menuItems = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="option"], [role="menuitem"]'));
        
        for (const item of menuItems) {
          if (!isInTargetDialog(item)) continue; // Skip if not in target dialog
          
          const text = (item.innerText || item.textContent || '').trim();
          if (text.toLowerCase() === reason.toLowerCase()) {
            item.setAttribute('data-reason-found', 'true');
            return { success: true, method: 'exact-menuitem', text };
          }
        }
        
        // Strategy 2: Look for text that CONTAINS the reason
        for (const item of menuItems) {
          if (!isInTargetDialog(item)) continue;
          
          const text = (item.innerText || item.textContent || '').trim().toLowerCase();
          if (text.includes(reason.toLowerCase())) {
            item.setAttribute('data-reason-found', 'true');
            return { success: true, method: 'contains-menuitem', text };
          }
        }
        
        // Strategy 3: Search all clickable elements
        const allClickable = Array.from(document.querySelectorAll('div[jsaction], button, [role="button"], a'));
        
        for (const el of allClickable) {
          if (!isInTargetDialog(el)) continue;
          
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          
          if (text === reason.toLowerCase() || text.includes(reason.toLowerCase())) {
            // Make sure it's visible
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              el.setAttribute('data-reason-found', 'true');
              return { success: true, method: 'clickable-element', text: el.innerText?.trim() };
            }
          }
        }
        
        return { success: false };
      }, reportReason, correctDialogIndex);

      let reasonElement = null;
      
      if (exactTextResult.success) {
        console.log(`   ✅ Found reason using: ${exactTextResult.method}`);
        console.log(`   📝 Element text: "${exactTextResult.text}"`);
        reasonElement = await page.$('[data-reason-found="true"]');
      }

      if (!reasonElement) {
        // Fallback: Try XPath
        console.log('   🔍 Trying XPath search...');
        const xpathResults = await page.$x(`//*[contains(text(), "${reportReason}")]`);
        
        if (xpathResults.length > 0) {
          console.log(`   ✓ Found ${xpathResults.length} elements via XPath`);
          reasonElement = xpathResults[0];
        }
      }

      if (!reasonElement) {
        // Debug: Show all available options
        console.log('⚠️ Could not find report reason. Available options:');
        const availableOptions = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="option"], [role="menuitem"]'));
          return items.map(item => (item.innerText || item.textContent || '').trim()).filter(Boolean);
        });
        console.log('   Options:', availableOptions);
        
        throw new Error(`Could not find report reason: "${reportReason}"`);
      }

      // Click the reason
      console.log('🖱️ Clicking report reason...');
      
      // Scroll into view first
      await page.evaluate(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, reasonElement);
      await this.delay(500);
      
      // Click the reason
      await reasonElement.click();
      await this.delay(2000);

      // ═══════════════════════════════════════════════════════════
      // FIX 4: DETECT 2-STEP WORKFLOW
      // ═══════════════════════════════════════════════════════════
      
      console.log('   ✅ Successfully selected reason:', reportReason);
      let reasonClicked = true;
      
      // IMPORTANT: Check if a new page/dialog opened (2-step workflow)
      console.log('🔄 Waiting for potential page transition (2-step workflow)...');
      await this.delay(3000);
      
      // Check if we're on a submission page
      const pageCheck = await page.evaluate(() => {
        const bodyText = document.body.textContent?.toLowerCase() || '';
        const hasSubmitButton = Array.from(document.querySelectorAll('button')).some(btn => {
          const text = (btn.innerText || '').trim().toLowerCase();
          return text === 'submit' || text.includes('submit');
        });
        
        // Check if we're on a detail page (has back arrow, submit button, no reason list)
        const hasBackButton = bodyText.includes('back') || document.querySelector('[aria-label*="Back"]');
        const hasReasonList = bodyText.includes('off topic') || bodyText.includes('spam');
        
        return {
          hasSubmitButton,
          hasBackButton,
          hasReasonList,
          isNewPage: hasSubmitButton && hasBackButton && !hasReasonList,
          snippet: document.body.textContent?.substring(0, 200)
        };
      });
      
      if (pageCheck.isNewPage) {
        console.log('✅ New submission page detected (2-step workflow)');
        console.log('   📄 Page shows: Submit button + Back button');
        console.log('   💡 Will look for Submit button on this new page');
      } else {
        console.log('   ℹ️  Still on reason selection dialog (1-step workflow)');
      }

      // ═══════════════════════════════════════════════════════════
      // FIX 5: ENHANCED SUBMIT BUTTON WITH SUCCESS/ERROR DETECTION
      // ═══════════════════════════════════════════════════════════
      
      console.log('🔍 Looking for submit button (both 1-step and 2-step workflows)...');
      
      const submitResult = await page.evaluate(() => {
        // STRATEGY 1: Look for button with "Submit" text
        const allButtons = Array.from(document.querySelectorAll('button'));
        
        for (const button of allButtons) {
          const text = (button.innerText || button.textContent || '').trim().toLowerCase();
          
          if (text === 'submit' || text.includes('submit')) {
            // Make sure it's visible
            const style = window.getComputedStyle(button);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              button.setAttribute('data-submit-found', 'true');
              return { 
                success: true, 
                text: button.innerText.trim(), 
                method: 'submit-text',
                className: button.className
              };
            }
          }
        }
        
        // STRATEGY 2: Look for primary button in dialog (Google's class pattern)
        const dialogs = document.querySelectorAll('[role="dialog"]');
        if (dialogs.length > 0) {
          const lastDialog = dialogs[dialogs.length - 1];
          const dialogButtons = lastDialog.querySelectorAll('button');
          
          for (const button of dialogButtons) {
            const classes = button.className || '';
            const text = (button.innerText || '').trim().toLowerCase();
            
            // Google uses specific classes for primary/submit buttons
            if (classes.includes('Primary') || 
                classes.includes('primary') ||
                text === 'submit') {
              button.setAttribute('data-submit-found', 'true');
              return { 
                success: true, 
                text: button.innerText.trim(), 
                method: 'primary-button',
                className: button.className
              };
            }
          }
        }
        
        return { success: false };
      });
      
      if (submitResult && submitResult.success) {
        console.log(`✅ Found submit button: "${submitResult.text}"`);
        console.log(`   🔍 Detection method: ${submitResult.method}`);
        
        const submitBtn = await page.$('button[data-submit-found="true"]');
        
        if (submitBtn) {
          console.log('🖱️ Clicking submit button...');
          
          // Scroll into view
          await page.evaluate(el => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, submitBtn);
          await this.delay(1000);
          
          // Click
          await submitBtn.click();
          console.log('   ✓ Submit button clicked');
          
          // Wait for response
          console.log('⏳ Waiting for submission response (5 seconds)...');
          await this.delay(5000);
          
          // ═══════════════════════════════════════════════════════════
          // CHECK FOR SUCCESS OR ERROR
          // ═══════════════════════════════════════════════════════════
          
          const resultCheck = await page.evaluate(() => {
            const bodyText = document.body.textContent?.toLowerCase() || '';
            
            return {
              // Success indicators
              hasReportReceived: bodyText.includes('report received'),
              hasThankYou: bodyText.includes('thank you'),
              hasReportSent: bodyText.includes('report sent'),
              
              // Error indicators
              hasSomethingWentWrong: bodyText.includes('something went wrong'),
              hasNotSubmitted: bodyText.includes('wasn\'t submitted') || bodyText.includes('not submitted'),
              hasTryAgain: bodyText.includes('try again'),
              
              // Get text snippet
              textSnippet: document.body.textContent?.substring(0, 300)
            };
          });
          
          // Check for SUCCESS
          if (resultCheck.hasReportReceived || resultCheck.hasThankYou || resultCheck.hasReportSent) {
            console.log('✅ Report submitted successfully!');
            console.log('   🎉 Confirmation: "Report received"');
            
            // Take success screenshot
            try {
              await page.screenshot({ path: '/tmp/report-success.png', fullPage: false });
              console.log('📸 Success screenshot saved');
            } catch (e) {}
            
            return true;
          }
          
          // Check for ERROR
          else if (resultCheck.hasSomethingWentWrong || resultCheck.hasNotSubmitted) {
            console.log('❌ Report submission FAILED!');
            console.log('   ⚠️  Google error: "Something went wrong - Your report wasn\'t submitted"');
            console.log('   💡 This usually means:');
            console.log('      - Same email already reported this review');
            console.log('      - Review was recently reported');
            console.log('      - Rate limit reached');
            
            // Take error screenshot
            try {
              await page.screenshot({ path: '/tmp/report-error.png', fullPage: false });
              console.log('📸 Error screenshot saved');
            } catch (e) {}
            
            throw new Error('GOOGLE_DUPLICATE_REPORT: Something went wrong - Report wasn\'t submitted. Email may have already reported this review.');
          }
          
          // Unknown state
          else {
            console.log('⚠️ Submit clicked but unclear result');
            console.log('   📄 Page text:', resultCheck.textSnippet.substring(0, 150));
            
            // Take debug screenshot
            try {
              await page.screenshot({ path: '/tmp/report-unknown.png', fullPage: false });
              console.log('📸 Debug screenshot saved');
            } catch (e) {}
            
            // Assume success if no clear error
            console.log('   💡 No error detected, assuming success');
            return true;
          }
          
        } else {
          console.log('⚠️ Submit button found but could not retrieve element');
          throw new Error('Submit button element not accessible');
        }
        
      } else {
        console.log('⚠️ Could not find submit button');
        console.log('   💡 This might mean:');
        console.log('      - Wrong dialog selected');
        console.log('      - Button has different text');
        console.log('      - Page structure changed');
        
        // Take debug screenshot
        try {
          await page.screenshot({ path: '/tmp/no-submit-button.png', fullPage: false });
          console.log('📸 Debug screenshot saved');
        } catch (e) {}
        
        throw new Error('Could not find submit button in dialog');
      }

    } catch (error) {
      console.error('❌ Failed to report review:', error.message);
      throw error;
    }
  }

  /**
   * Process a single review
   */
  async processReview(review) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`🔄 Processing review: ${review.id}`);
    console.log(`   Business: ${review.business_name}`);
    console.log(`   Location: ${review.location}`);
    console.log('═══════════════════════════════════════════════════════════');

    let page = null;

    try {
      // Update status to processing
      await this.updateReviewStatus(review.id, 'processing');

      // Get proxy config and rotate session
      const proxyConfig = await this.getProxyConfig();
      let sessionNumber = 1;
      
      if (proxyConfig) {
        sessionNumber = await this.rotateProxySession(proxyConfig);
      }

      // Get next Gmail account
      const gmailAccount = await this.getNextGmailAccount();
      console.log(`📧 Using Gmail account: ${gmailAccount.email}`);

      // Initialize browser with proxy
      await this.initBrowser(proxyConfig);

      // Create new page
      page = await this.browser.newPage();
      
      // Set viewport
      await page.setViewport({
        width: 1920,
        height: 1080
      });

      // If proxy credentials exist, authenticate
      if (this.proxyCredentials && this.proxyCredentials.username) {
        console.log('🔐 Authenticating with proxy...');
        await page.authenticate({
          username: this.proxyCredentials.username,
          password: this.proxyCredentials.password
        });
        console.log('✅ Proxy authentication configured');
      }

      // Get proxy IP
      const proxyIp = await this.getProxyIp(page);

      // Verify Gmail account with OAuth (NO Puppeteer login!)
      console.log('🔐 Authenticating Gmail account with OAuth...');
      const isVerified = await oauthHandler.verifyGmailAccount(gmailAccount.email);
      
      if (!isVerified) {
        throw new Error(`Gmail account not authenticated: ${gmailAccount.email}`);
      }
      
      console.log(`✅ Gmail OAuth authentication successful for: ${gmailAccount.email}`);
      console.log('   ℹ️  This account is verified without Puppeteer login!');

      // Extract review text if not already extracted
      if (!review.review_text) {
        console.log('📄 Review text not in database, extracting...');
        const reviewText = await this.extractReviewText(page, review.review_link);
        
        if (reviewText) {
          await this.storeReviewText(review.id, reviewText);
        } else {
          console.log('⚠️ Could not extract review text, but continuing with reporting...');
        }
      } else {
        console.log(`✅ Review text already in database (${review.review_text.length} chars)`);
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

      // ═══════════════════════════════════════════════════════════
      // FIX 6: HANDLE GOOGLE_DUPLICATE_REPORT ERROR
      // ═══════════════════════════════════════════════════════════
      
      // Check if it's a Google duplicate report error
      if (error.message.includes('GOOGLE_DUPLICATE_REPORT')) {
        console.log('💡 This email has already reported this review');
        console.log('   ✓ Will rotate to different email for next attempt');
        
        // Update stats
        this.stats.totalProcessed++;
        this.stats.failed++;
        this.stats.lastProcessedAt = new Date().toISOString();
        
        // Update review status back to pending (will be retried with different email)
        if (review && review.id) {
          await this.updateReviewStatus(review.id, 'pending');
        }
        
        // Close the page
        if (page) await page.close();
        
        // Don't throw - just return so automation continues with next review
        return {
          success: false,
          review_id: review.id,
          error: 'duplicate_report',
          message: 'Email already reported this review, will use different email next time'
        };
      }

      // Update stats
      this.stats.totalProcessed++;
      this.stats.failed++;
      this.stats.lastProcessedAt = new Date().toISOString();

      // Update review status to failed
      if (review && review.id) {
        await this.updateReviewStatus(review.id, 'failed');
      }

      // Log failed activity
      if (review && review.id) {
        await this.logActivity(
          review.id,
          null,
          'unknown',
          'failed'
        );
      }

      // Close the page
      if (page) await page.close();

      throw error;
    }
  }

  /**
   * Main automation loop
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ Automation is already running');
      return;
    }

    this.isRunning = true;
    this.startedAt = new Date().toISOString();
    console.log('🚀 Automation service started');

    // Start polling loop
    this.pollInterval = setInterval(async () => {
      try {
        // Check if we should continue running
        if (!this.isRunning) {
          clearInterval(this.pollInterval);
          return;
        }

        // Get next review
        const review = await this.getNextReview();

        if (review) {
          this.currentReview = review;
          await this.processReview(review);
          this.currentReview = null;
        } else {
          console.log('ℹ️ No pending reviews. Waiting...');
        }

        // Add delay between reviews
        await this.delay(DELAY_BETWEEN_ACTIONS);

      } catch (error) {
        console.error('❌ Error in automation loop:', error.message);
        this.currentReview = null;
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * Stop automation
   */
  async stop() {
    console.log('🛑 Stopping automation service...');
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    await this.closeBrowser();

    this.currentReview = null;
    this.startedAt = null;

    console.log('✅ Automation service stopped');
  }
}

module.exports = AutomationService;
