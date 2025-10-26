/**
 * ═══════════════════════════════════════════════════════════════════════
 * GOOGLE MAPS REVIEW REPORTER - PRODUCTION-READY AUTOMATION SERVICE
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * ✅ ALL CRITICAL FIXES INTEGRATED:
 * - Fixed dialog detection (waitForReportDialog prevents zoom dialog confusion)
 * - Database tracking for reporting history 
 * - Interval enforcement (20 min between same review reports)
 * - IP rotation enforcement (no duplicate IPs per review)
 * - Email validation (same email can't report same review twice)
 * - Report reason tracking
 * - Legal reporting history
 * - OAuth 2.0 Gmail authentication
 * - Residential proxy support with session-based IP rotation
 * 
 * READY TO COPY-PASTE TO GITHUB!
 * ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// CRITICAL FIX: Wait for REPORT dialog specifically (not zoom dialog!)
// ═══════════════════════════════════════════════════════════════════════
async function waitForReportDialog(page, maxAttempts = 5) {
  console.log('🔍 Waiting for REPORT dialog to appear...');
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`   Attempt ${attempt}/${maxAttempts}...`);
    
    try {
      // Wait for dialog with report-specific content
      const dialogFound = await page.waitForFunction(() => {
        const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        
        for (const dialog of dialogs) {
          const text = (dialog.textContent || '').toLowerCase();
          const html = dialog.innerHTML.toLowerCase();
          
          // Look for report dialog indicators
          if (
            text.includes('why are you reporting') ||
            text.includes('report this review') ||
            text.includes('choose a reason') ||
            text.includes('fake review') ||
            text.includes('conflict of interest') ||
            text.includes('offensive content') ||
            text.includes('inappropriate') ||
            html.includes('role="radio"') && (
              text.includes('fake') ||
              text.includes('offensive') ||
              text.includes('conflict')
            )
          ) {
            // Mark this as the report dialog
            dialog.setAttribute('data-report-dialog', 'true');
            return true;
          }
        }
        return false;
      }, { timeout: 5000 });
      
      if (dialogFound) {
        console.log('   ✅ Found REPORT dialog!');
        await page.waitForTimeout(2000); // Let it fully render
        return true;
      }
    } catch (e) {
      console.log(`   ⚠️ Attempt ${attempt} failed: ${e.message}`);
      
      // If not last attempt, close any wrong dialogs and retry
      if (attempt < maxAttempts) {
        console.log('   🔄 Closing any non-report dialogs...');
        await page.evaluate(() => {
          const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
          for (const dialog of dialogs) {
            const text = (dialog.textContent || '').toLowerCase();
            // Close if it's a map control dialog
            if (text.includes('zoom') && !text.includes('report')) {
              // Try to find and click close button
              const closeBtn = dialog.querySelector('button[aria-label*="Close"], button[aria-label*="close"]');
              if (closeBtn) closeBtn.click();
            }
          }
        });
        await page.waitForTimeout(1000);
      }
    }
  }
  
  console.log('   ❌ Could not find REPORT dialog after all attempts');
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// DATABASE: Check if email already reported this review
// ═══════════════════════════════════════════════════════════════════════
async function hasEmailReportedReview(reviewId, email) {
  const { data, error } = await supabase
    .from('reporting_history')
    .select('id')
    .eq('review_id', reviewId)
    .eq('gmail_account_email', email)
    .eq('status', 'success')
    .maybeSingle();
  
  if (error) {
    console.log('⚠️ Error checking email history:', error.message);
    return false;
  }
  
  return !!data;
}

// ═══════════════════════════════════════════════════════════════════════
// DATABASE: Check if review can be reported (20 min rule)
// ═══════════════════════════════════════════════════════════════════════
async function canReportReview(reviewId) {
  const { data, error} = await supabase
    .from('reporting_history')
    .select('reported_at')
    .eq('review_id', reviewId)
    .eq('status', 'success')
    .order('reported_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    console.log('⚠️ Error checking report interval:', error.message);
    return true; // Allow if error
  }
  
  if (!data) {
    return true; // Never reported, can report
  }
  
  const lastReportTime = new Date(data.reported_at);
  const now = new Date();
  const minutesSince = (now - lastReportTime) / 1000 / 60;
  
  const canReport = minutesSince >= 20;
  
  if (!canReport) {
    console.log(`⏳ Must wait ${Math.ceil(20 - minutesSince)} more minutes before reporting this review again`);
  }
  
  return canReport;
}

// ═══════════════════════════════════════════════════════════════════════
// DATABASE: Get last IP used for this review
// ═══════════════════════════════════════════════════════════════════════
async function getLastIpForReview(reviewId) {
  const { data, error } = await supabase
    .from('reporting_history')
    .select('proxy_ip')
    .eq('review_id', reviewId)
    .eq('status', 'success')
    .order('reported_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error || !data) {
    return null;
  }
  
  return data.proxy_ip;
}

// ═══════════════════════════════════════════════════════════════════════
// DATABASE: Save reporting history
// ═══════════════════════════════════════════════════════════════════════
async function saveReportingHistory(reviewId, gmailEmail, gmailAccountId, proxyIp, proxySession, reportReason, status, errorMessage = null) {
  const { data, error } = await supabase
    .from('reporting_history')
    .insert({
      review_id: reviewId,
      gmail_account_email: gmailEmail,
      gmail_account_id: gmailAccountId,
      proxy_ip: proxyIp,
      proxy_session: proxySession,
      report_reason: reportReason,
      status: status,
      error_message: errorMessage,
      reported_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) {
    console.log('⚠️ Error saving reporting history:', error.message);
    return null;
  }
  
  console.log('✅ Reporting history saved to database');
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// DATABASE: Update review with report reason
// ═══════════════════════════════════════════════════════════════════════
async function updateReviewReportReason(reviewId, reportReason) {
  const { error } = await supabase
    .from('reviews')
    .update({
      report_reason: reportReason,
      last_reported_at: new Date().toISOString()
    })
    .eq('id', reviewId);
  
  if (error) {
    console.log('⚠️ Error updating review report reason:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// AUTOMATION SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════
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
   * Update Gmail account last used timestamp
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
    const logData = {
      review_id: reviewId,
      gmail_id: gmailId,
      proxy_ip: proxyIp,
      status,
      started_at: new Date().toISOString()
    };

    if (status === 'completed' || status === 'failed') {
      logData.completed_at = new Date().toISOString();
    }

    if (errorMessage) {
      logData.error_message = errorMessage;
    }

    await supabase
      .from('automation_logs')
      .insert(logData);
  }

  /**
   * Helper function to add delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Process a single review (main automation logic)
   */
  async processReview(review, gmailAccount, currentProxy) {
    const reviewId = review.id;
    const gmailEmail = gmailAccount.email;
    const reportReason = review.report_reason || 'Default';
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎯 STARTING REVIEW PROCESSING');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Review ID: ${reviewId}`);
    console.log(`Business: ${review.business_name}`);
    console.log(`Gmail: ${gmailEmail}`);
    console.log(`Proxy IP: ${currentProxy.currentIp}`);
    console.log(`Report Reason: ${reportReason}`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    
    // ═══════════════════════════════════════════════════════════════════════
    // VALIDATION CHECKS (Enforce legal reporting rules)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('🔍 Validating reporting rules...');
    
    // Check if this email already reported this review
    const alreadyReported = await hasEmailReportedReview(reviewId, gmailEmail);
    if (alreadyReported) {
      console.log(`⚠️ Email ${gmailEmail} has already reported this review`);
      throw new Error('Email has already reported this review');
    }
    console.log(`✅ Email ${gmailEmail} has not reported this review yet`);
    
    // Check if review can be reported (20 min interval)
    const canReport = await canReportReview(reviewId);
    if (!canReport) {
      throw new Error('Must wait 20 minutes before reporting this review again');
    }
    console.log('✅ 20-minute interval satisfied');
    
    // Check if we need a new IP (last IP used for this review)
    const lastIp = await getLastIpForReview(reviewId);
    if (lastIp && lastIp === currentProxy.currentIp) {
      console.log(`⚠️ Cannot use same IP (${currentProxy.currentIp}) that was used before for this review`);
      throw new Error('Cannot use same IP as previous report');
    }
    if (lastIp) {
      console.log(`✅ Using new IP (${currentProxy.currentIp}) - different from last IP (${lastIp})`);
    } else {
      console.log(`✅ First report for this review, IP ${currentProxy.currentIp} is acceptable`);
    }
    
    console.log('');
    console.log('✅ All validation checks passed');
    console.log('');
    
    let page = null;
    
    try {
      // Create a new page (puppeteer-core doesn't support createIncognitoBrowserContext with chromium)
      page = await this.browser.newPage();
      
      // Set up proxy authentication if credentials are available
      if (this.proxyCredentials) {
        console.log('🔐 Setting up proxy authentication...');
        await page.authenticate({
          username: this.proxyCredentials.username,
          password: this.proxyCredentials.password
        });
        console.log('✅ Proxy authentication configured');
      }
      
      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });
      
      console.log('🌐 Navigating to Google Maps review...');
      await page.goto(review.review_link, { waitUntil: 'networkidle0', timeout: 60000 });
      
      console.log('⏳ Waiting for page to load...');
      await this.delay(3000);
      
      // ═══════════════════════════════════════════════════════════════
      // OAUTH LOGIN TO GMAIL
      // ═══════════════════════════════════════════════════════════════
      console.log('🔐 Authenticating with Gmail via OAuth...');
      
      const loginResult = await oauthHandler.loginWithOAuth(
        page,
        gmailAccount.id,
        gmailAccount.email
      );
      
      if (!loginResult.success) {
        throw new Error(`OAuth login failed: ${loginResult.error}`);
      }
      
      console.log('✅ Successfully logged in to Gmail');
      
      // Wait for page to stabilize after login
      await this.delay(3000);
      
      // Navigate back to review page after login
      console.log('🌐 Returning to review page...');
      await page.goto(review.review_link, { waitUntil: 'networkidle0', timeout: 60000 });
      await this.delay(3000);
      
      // ═══════════════════════════════════════════════════════════════
      // FIND AND CLICK MENU BUTTON (More/Actions button)
      // ═══════════════════════════════════════════════════════════════
      console.log('🔍 Looking for menu button (More/Actions)...');
      
      // Wait 3 seconds before searching for menu button (Fix 1)
      await this.delay(3000);
      
      const menuButton = await page.evaluate(() => {
        // Strategy 1: Find by aria-label containing "more" or "actions" (case-insensitive)
        const allButtons = Array.from(document.querySelectorAll('button'));
        
        // Try "More options" first
        let button = allButtons.find(b => {
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          return label.includes('more') && label.includes('option');
        });
        
        // Try just "Actions" (Fix 3: Fallback)
        if (!button) {
          button = allButtons.find(b => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            return label.includes('actions') || label.includes('action');
          });
        }
        
        // Try "More"
        if (!button) {
          button = allButtons.find(b => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            return label === 'more' || label.startsWith('more ');
          });
        }
        
        if (button) {
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
        
        return false;
      });
      
      if (!menuButton) {
        throw new Error('Could not find menu button (More/Actions)');
      }
      
      console.log('✅ Found menu button');
      await this.delay(1000);
      
      // Click the menu button
      console.log('🖱️ Clicking menu button...');
      await page.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button'));
        const button = allButtons.find(b => {
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          return label.includes('more') || label.includes('action');
        });
        if (button) button.click();
      });
      
      console.log('✅ Menu button clicked');
      await this.delay(2000);
      
      // ═══════════════════════════════════════════════════════════════
      // FIND AND CLICK REPORT OPTION IN MENU
      // ═══════════════════════════════════════════════════════════════
      console.log('🔍 Looking for "Report review" option in menu...');
      
      const reportOption = await page.evaluateHandle(() => {
        const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, a'));
        
        const reportItem = menuItems.find(item => {
          const text = (item.textContent || '').toLowerCase();
          return text.includes('report') && (text.includes('review') || text.includes('this'));
        });
        
        if (reportItem) {
          reportItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return reportItem;
        }
        
        return null;
      });
      
      if (!reportOption) {
        throw new Error('Could not find "Report review" option in menu');
      }
      
      console.log('✅ Found "Report review" option');
      await this.delay(1000);
      
      // ═══════════════════════════════════════════════════════════════
      // CLICK REPORT OPTION WITH ENHANCED DIALOG DETECTION
      // ═══════════════════════════════════════════════════════════════
      console.log('🖱️ Clicking report option...');
      
      let reportDialogOpened = false;
      
      // Try standard click
      try {
        await reportOption.click();
        console.log('   ✓ Standard click executed');
        await this.delay(2000);
        
        // Use the new waitForReportDialog function
        reportDialogOpened = await waitForReportDialog(page);
        
        if (reportDialogOpened) {
          console.log('   ✅ Report dialog opened after standard click');
        }
      } catch (e) {
        console.log('   ⚠️ Standard click failed:', e.message);
      }
      
      // Try JavaScript click
      if (!reportDialogOpened) {
        console.log('   Trying JavaScript click...');
        try {
          await page.evaluate((el) => el.click(), reportOption);
          await this.delay(2000);
          reportDialogOpened = await waitForReportDialog(page);
          
          if (reportDialogOpened) {
            console.log('   ✅ Report dialog opened after JavaScript click');
          }
        } catch (e) {
          console.log('   ⚠️ JavaScript click failed:', e.message);
        }
      }
      
      // Try dispatch click event
      if (!reportDialogOpened) {
        console.log('   Trying dispatch click event...');
        try {
          await page.evaluate((el) => {
            const event = new MouseEvent('click', {
              view: window,
              bubbles: true,
              cancelable: true
            });
            el.dispatchEvent(event);
          }, reportOption);
          await this.delay(2000);
          reportDialogOpened = await waitForReportDialog(page);
          
          if (reportDialogOpened) {
            console.log('   ✅ Report dialog opened after dispatch event');
          }
        } catch (e) {
          console.log('   ⚠️ Dispatch event failed:', e.message);
        }
      }
      
      if (!reportDialogOpened) {
        throw new Error('Could not open report dialog after all attempts');
      }
      
      console.log('   ⏳ Waiting for dialog content to appear...');
      await this.delay(3000);
      
      // ═══════════════════════════════════════════════════════════════
      // EXTRACT AVAILABLE REPORT REASONS FROM MARKED DIALOG
      // ═══════════════════════════════════════════════════════════════
      console.log('🔍 Debugging available report reasons...');
      
      const debugResult = await page.evaluate(() => {
        const reasons = [];
        const debugInfo = {};
        
        // Get the marked report dialog
        const reportDialog = document.querySelector('[data-report-dialog="true"]');
        
        if (!reportDialog) {
          debugInfo.error = 'No report dialog found';
          return { reasons: [], debugInfo };
        }
        
        debugInfo.selectedDialog = {
          textSnippet: reportDialog.textContent?.substring(0, 300),
          labelCount: reportDialog.querySelectorAll('label').length,
          radioCount: reportDialog.querySelectorAll('[role="radio"]').length,
          buttonCount: reportDialog.querySelectorAll('button').length
        };
        
        // Extract all potential report reasons
        const elements = Array.from(reportDialog.querySelectorAll([
          'label',
          '[role="radio"]',
          '[role="option"]',
          '.VfPpkd-StrnGf-rymPhb',
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
      
      console.log('📋 Debug Info:', JSON.stringify(debugResult.debugInfo, null, 2));
      console.log('📋 Available reasons:', JSON.stringify(debugResult.reasons, null, 2));
      
      if (debugResult.reasons.length === 0) {
        throw new Error('No report reasons found in dialog');
      }
      
      // ═══════════════════════════════════════════════════════════════
      // SELECT REPORT REASON
      // ═══════════════════════════════════════════════════════════════
      console.log('🎯 Selecting report reason...');
      
      // PRIORITY 1: For legal reporting, click "Report a legal issue"
      let selectedReason = debugResult.reasons.find(r => 
        r.text.toLowerCase().includes('report a legal issue') ||
        r.text.toLowerCase().includes('legal issue')
      );
      
      // PRIORITY 2: If not legal reporting or button not found, select appropriate reason
      if (!selectedReason) {
        selectedReason = debugResult.reasons.find(r => {
          const text = r.text.toLowerCase();
          
          // Type 2 dialog (Most reviews): Spam, Conflict of interest, Off topic
          if (text.includes('spam') || 
              text.includes('conflict of interest') ||
              text.includes('conflict')) {
            return true;
          }
          
          // Type 1 dialog (Some reviews): Fake or deceptive
          if (text.includes('fake') || text.includes('deceptive')) {
            return true;
          }
          
          // Both types: Off topic / Low quality
          if (text.includes('off topic') || 
              text.includes('low quality')) {
            return true;
          }
          
          return false;
        });
      }
      
      // FALLBACK: Use first available option
      if (!selectedReason) {
        selectedReason = debugResult.reasons[0];
      }
      
      console.log(`   Selected reason: "${selectedReason.text}"`);
      
      await page.evaluate((index) => {
        const dialog = document.querySelector('[data-report-dialog="true"]');
        const elements = Array.from(dialog.querySelectorAll([
          'label',
          '[role="radio"]',
          '[role="option"]',
          '.VfPpkd-StrnGf-rymPhb',
          'div[jsaction*="click"]'
        ].join(', ')));
        
        if (elements[index]) {
          elements[index].click();
        }
      }, selectedReason.index);
      
      console.log('✅ Report reason selected');
      await this.delay(2000);
      
      // ═══════════════════════════════════════════════════════════════
      // CHECK FOR 2-STEP WORKFLOW (Fix 4)
      // ═══════════════════════════════════════════════════════════════
      console.log('🔍 Checking for Next/Continue button...');
      
      const hasNextButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(b => {
          const text = (b.textContent || '').toLowerCase();
          return text === 'next' || text === 'continue' || text.includes('next');
        });
      });
      
      if (hasNextButton) {
        console.log('   ✅ Found Next/Continue button - clicking...');
        
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const nextBtn = buttons.find(b => {
            const text = (b.textContent || '').toLowerCase();
            return text === 'next' || text === 'continue' || text.includes('next');
          });
          if (nextBtn) nextBtn.click();
        });
        
        await this.delay(3000);
        console.log('   ✅ Clicked Next button, waiting for final submission screen...');
      }
      
      // ═══════════════════════════════════════════════════════════════
      // SUBMIT THE REPORT (Fix 5: Enhanced submit detection)
      // ═══════════════════════════════════════════════════════════════
      console.log('🔍 Looking for Submit button...');
      
      const submitButton = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        
        const submitBtn = buttons.find(b => {
          const text = (b.textContent || '').toLowerCase();
          return text.includes('submit') || text.includes('send') || text.includes('report');
        });
        
        if (submitBtn) {
          submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return submitBtn;
        }
        
        return null;
      });
      
      if (!submitButton) {
        throw new Error('Could not find Submit button');
      }
      
      console.log('✅ Found Submit button');
      await this.delay(1000);
      
      console.log('🖱️ Clicking Submit button...');
      await submitButton.click();
      
      console.log('✅ Report submitted successfully');
      await this.delay(3000);
      
      // ═══════════════════════════════════════════════════════════════
      // SAVE TO DATABASE
      // ═══════════════════════════════════════════════════════════════
      try {
        await saveReportingHistory(
          reviewId,
          gmailEmail,
          gmailAccount.id,
          currentProxy.currentIp,
          currentProxy.session,
          reportReason,
          'success',
          null
        );
        
        await updateReviewReportReason(reviewId, reportReason);
      } catch (dbError) {
        console.log('⚠️ Error saving to database:', dbError.message);
        // Don't fail the whole process if DB save fails
      }
      
      // Update review status
      await this.updateReviewStatus(reviewId, 'completed', gmailAccount.id);
      
      // Log success
      await this.logActivity(
        reviewId,
        gmailAccount.id,
        currentProxy.currentIp,
        'completed'
      );
      
      this.stats.successful++;
      this.stats.lastProcessedAt = new Date();
      
      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ REVIEW PROCESSING COMPLETED SUCCESSFULLY');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      
    } catch (error) {
      console.error('❌ Error processing review:', error.message);
      
      // ═══════════════════════════════════════════════════════════════
      // SAVE ERROR TO DATABASE
      // ═══════════════════════════════════════════════════════════════
      try {
        await saveReportingHistory(
          reviewId,
          gmailEmail,
          gmailAccount.id,
          currentProxy?.currentIp || 'unknown',
          currentProxy?.session || 'unknown',
          reportReason,
          'failed',
          error.message
        );
      } catch (dbError) {
        console.log('⚠️ Error saving error to database:', dbError.message);
      }
      
      // Update review status
      await this.updateReviewStatus(reviewId, 'failed', gmailAccount.id, error.message);
      
      // Log failure
      await this.logActivity(
        reviewId,
        gmailAccount.id,
        currentProxy?.currentIp || null,
        'failed',
        error.message
      );
      
      this.stats.failed++;
      
      throw error;
    } finally {
      // Always close the page
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Main automation loop
   */
  async run() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 AUTOMATION SERVICE STARTED');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    
    while (this.isRunning) {
      try {
        // Get next pending review
        const review = await this.getNextPendingReview();
        
        if (!review) {
          console.log('⏸️ No pending reviews. Waiting...');
          await this.delay(POLL_INTERVAL_MS);
          continue;
        }
        
        this.currentReview = review;
        
        // Get available Gmail account
        const gmailAccount = await this.getAvailableGmailAccount();
        
        if (!gmailAccount) {
          console.error('❌ No available Gmail accounts');
          await this.delay(POLL_INTERVAL_MS);
          continue;
        }
        
        // Get proxy configuration
        const proxyConfig = await this.getProxyConfig();
        
        if (!proxyConfig) {
          console.error('❌ No active proxy configuration');
          await this.delay(POLL_INTERVAL_MS);
          continue;
        }
        
        // Initialize browser with proxy
        await this.initBrowser(proxyConfig);
        
        // Build current proxy info for validation
        const { username } = this.buildProxyUrl(proxyConfig);
        const currentProxy = {
          currentIp: `${proxyConfig.proxy_address}:${proxyConfig.port}`,
          session: username
        };
        
        // Process the review
        await this.processReview(review, gmailAccount, currentProxy);
        
        // Update Gmail last used
        await this.updateGmailLastUsed(gmailAccount.id);
        
        this.stats.totalProcessed++;
        
        // Delay between reviews
        console.log(`⏳ Waiting ${DELAY_BETWEEN_ACTIONS / 1000}s before next review...`);
        await this.delay(DELAY_BETWEEN_ACTIONS);
        
      } catch (error) {
        console.error('❌ Error in automation loop:', error.message);
        
        // Close and reinitialize browser on error
        await this.closeBrowser();
        
        // Wait before retrying
        await this.delay(POLL_INTERVAL_MS);
      }
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🛑 AUTOMATION SERVICE STOPPED');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
  }

  /**
   * Start the automation service
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Automation is already running');
    }
    
    this.isRunning = true;
    this.startedAt = new Date();
    this.stats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      lastProcessedAt: null
    };
    
    // Start the automation loop (don't await - let it run in background)
    this.run().catch(error => {
      console.error('Fatal error in automation loop:', error);
      this.isRunning = false;
    });
    
    return {
      success: true,
      message: 'Automation started successfully'
    };
  }

  /**
   * Stop the automation service
   */
  async stop() {
    if (!this.isRunning) {
      throw new Error('Automation is not running');
    }
    
    this.isRunning = false;
    await this.closeBrowser();
    
    return {
      success: true,
      message: 'Automation stopped successfully',
      stats: this.stats
    };
  }
}

// Export the AutomationService class
module.exports = AutomationService;
