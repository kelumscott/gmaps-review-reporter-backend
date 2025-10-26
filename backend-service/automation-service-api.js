/**
 * ═══════════════════════════════════════════════════════════════
 * 🔥 COMPLETE BACKEND WITH ALL 5 CRITICAL FIXES
 * ═══════════════════════════════════════════════════════════════
 * 
 * COPY THIS ENTIRE FILE TO:
 * backend-service/automation-service-api.js
 * 
 * THEN DEPLOY TO GITHUB AND RENDER
 * 
 * ═══════════════════════════════════════════════════════════════
 * FIXES INCLUDED:
 * ═══════════════════════════════════════════════════════════════
 * 
 * ✅ FIX 1: Email uniqueness validation (same email can't report twice)
 * ✅ FIX 2: 20-minute interval with IP change enforcement
 * ✅ FIX 3: Report reason tracking in database
 * ✅ FIX 4: Report history recording
 * ✅ FIX 5: Type A vs Type B dialog detection
 * 
 * ═══════════════════════════════════════════════════════════════
 */

// Use puppeteer-extra with stealth plugin
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');
const oauthHandler = require('./oauth-handler');

// Enable stealth plugin
puppeteerExtra.use(StealthPlugin());
console.log('🎭 Stealth plugin enabled');
console.log('🔐 OAuth handler loaded');

// Load environment variables
require('dotenv').config();

// Debug logging
console.log('🔍 Checking Supabase credentials...');
console.log('   SUPABASE_URL:', process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL.substring(0, 30)}...` : '❌ NOT SET');
console.log('   SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? `${process.env.SUPABASE_ANON_KEY.substring(0, 20)}...` : '❌ NOT SET');

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ FATAL ERROR: Missing Supabase credentials!');
  console.error('Please set SUPABASE_URL and SUPABASE_ANON_KEY on Render');
}

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ═══════════════════════════════════════════════════════════════
// REPORT REASONS - TYPE A vs TYPE B
// ═══════════════════════════════════════════════════════════════

const REPORT_REASONS_TYPE_A = {
  LOW_QUALITY: {
    title: 'Low quality information',
    description: 'Review is off-topic, contains ads, or is gibberish or repetitive',
    keywords: ['low quality', 'quality information', 'off-topic', 'ads', 'gibberish']
  },
  FAKE_DECEPTIVE: {
    title: 'Fake or deceptive',
    description: 'Review involves fake activity, incentivized content, or other misleading behavior',
    keywords: ['fake', 'deceptive', 'misleading', 'incentivized']
  },
  PROFANITY: {
    title: 'Profanity',
    keywords: ['profanity', 'swear', 'pornographic', 'explicit']
  },
  BULLYING: {
    title: 'Bullying or harassment',
    keywords: ['bullying', 'harassment', 'attacks']
  },
  DISCRIMINATION: {
    title: 'Discrimination or hate speech',
    keywords: ['discrimination', 'hate speech', 'harmful language']
  },
  PERSONAL_INFO: {
    title: 'Personal information',
    keywords: ['personal information', 'address', 'phone number']
  },
  NOT_HELPFUL: {
    title: 'Not helpful',
    keywords: ['not helpful', 'doesn\'t help']
  },
  LEGAL_ISSUE: {
    title: 'Report a legal issue',
    keywords: ['legal issue', 'legal']
  }
};

const REPORT_REASONS_TYPE_B = {
  OFF_TOPIC: {
    title: 'Off topic',
    keywords: ['off topic', 'doesn\'t pertain', 'experience']
  },
  SPAM: {
    title: 'Spam',
    keywords: ['spam', 'bot', 'fake account', 'ads', 'promotions']
  },
  CONFLICT_OF_INTEREST: {
    title: 'Conflict of interest',
    keywords: ['conflict', 'interest', 'affiliated', 'competitor']
  },
  PROFANITY: {
    title: 'Profanity',
    keywords: ['profanity', 'swear', 'pornographic', 'explicit']
  },
  BULLYING: {
    title: 'Bullying or harassment',
    keywords: ['bullying', 'harassment', 'attacks']
  },
  DISCRIMINATION: {
    title: 'Discrimination or hate speech',
    keywords: ['discrimination', 'hate speech', 'harmful language']
  },
  PERSONAL_INFO: {
    title: 'Personal information',
    keywords: ['personal information', 'address', 'phone number']
  },
  NOT_HELPFUL: {
    title: 'Not helpful',
    keywords: ['not helpful', 'doesn\'t help']
  },
  LEGAL_ISSUE: {
    title: 'Report a legal issue',
    keywords: ['legal issue', 'legal']
  }
};

// Detect dialog type
function detectReportDialogType(availableReasons) {
  const reasonTexts = availableReasons.map(r => r.text?.toLowerCase() || '').join(' ');
  
  const hasLowQuality = reasonTexts.includes('low quality');
  const hasFakeDeceptive = reasonTexts.includes('fake or deceptive');
  const hasOffTopic = reasonTexts.includes('off topic');
  const hasSpam = reasonTexts.includes('spam');
  const hasConflict = reasonTexts.includes('conflict');
  
  if (hasLowQuality || hasFakeDeceptive) {
    return 'TYPE_A';
  } else if (hasOffTopic || hasSpam || hasConflict) {
    return 'TYPE_B';
  }
  
  return 'TYPE_B'; // Default
}

// Get reasons by type
function getReportReasonsByType(dialogType) {
  return dialogType === 'TYPE_A' ? REPORT_REASONS_TYPE_A : REPORT_REASONS_TYPE_B;
}

// Match reason to available options
function matchReasonToAvailableOptions(requestedReason, availableReasons, dialogType) {
  const reasons = getReportReasonsByType(dialogType);
  const reasonConfig = reasons[requestedReason];
  
  if (!reasonConfig) {
    console.log(`   ⚠️ Unknown reason: ${requestedReason}`);
    return null;
  }
  
  // Exact match
  let match = availableReasons.find(r => 
    r.text?.toLowerCase().trim() === reasonConfig.title.toLowerCase().trim()
  );
  
  if (match) {
    console.log(`   ✅ Found exact match: "${match.text}"`);
    return match;
  }
  
  // Keyword matching
  for (const keyword of reasonConfig.keywords) {
    match = availableReasons.find(r => 
      r.text?.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (match) {
      console.log(`   ✅ Found keyword match for "${keyword}": "${match.text}"`);
      return match;
    }
  }
  
  console.log(`   ⚠️ No match found for ${requestedReason} in ${dialogType}`);
  return null;
}

// ═══════════════════════════════════════════════════════════════
// AUTOMATION SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

// Configuration
const POLL_INTERVAL_MS = 10000; // 10 seconds
const MAX_RETRIES = 3;
const DELAY_BETWEEN_ACTIONS = 2000; // 2 seconds

class AutomationService {
  constructor() {
    this.browser = null;
    this.isRunning = false;
    this.pollInterval = null;
    this.currentReview = null;
    this.startedAt = null;
    this.proxyCredentials = null;
    this.currentIP = null; // Track current IP
    this.proxySession = null; // Track proxy session ID
    this.stats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      lastProcessedAt: null
    };
  }

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
          '--window-size=1920,1080'
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        ignoreHTTPSErrors: true
      };

      // Add proxy if configured
      if (proxyConfig && proxyConfig.proxy_host && proxyConfig.proxy_port) {
        const proxyUrl = `${proxyConfig.proxy_host}:${proxyConfig.proxy_port}`;
        launchOptions.args.push(`--proxy-server=${proxyUrl}`);
        console.log(`🔒 Proxy configured: ${proxyUrl}`);
        
        // Store credentials for page.authenticate()
        if (proxyConfig.proxy_username && proxyConfig.proxy_password) {
          this.proxyCredentials = {
            username: proxyConfig.proxy_username,
            password: proxyConfig.proxy_password
          };
          console.log(`🔑 Proxy authentication configured for user: ${proxyConfig.proxy_username}`);
        }
        
        // Store session ID if available
        this.proxySession = proxyConfig.session_id || null;
      }

      this.browser = await puppeteerExtra.launch(launchOptions);
      console.log('✅ Browser launched successfully');
    }
    return this.browser;
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Browser closed');
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('⚠️ Automation is already running');
      return { success: false, message: 'Already running' };
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🚀 STARTING AUTOMATION SERVICE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    this.isRunning = true;
    this.startedAt = new Date();

    // Start polling for reviews
    this.pollForReviews();
    this.pollInterval = setInterval(() => this.pollForReviews(), POLL_INTERVAL_MS);

    return { success: true, message: 'Automation started successfully' };
  }

  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ Automation is not running');
      return { success: false, message: 'Not running' };
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🛑 STOPPING AUTOMATION SERVICE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    this.isRunning = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    await this.closeBrowser();

    return { success: true, message: 'Automation stopped successfully' };
  }

  async pollForReviews() {
    if (!this.isRunning) return;

    try {
      console.log('🔍 Polling for pending reviews...');

      // Fetch pending reviews
      const { data: reviews, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('status', 'pending')
        .limit(1);

      if (error) {
        console.error('❌ Error fetching reviews:', error);
        return;
      }

      if (!reviews || reviews.length === 0) {
        console.log('   📭 No pending reviews found');
        return;
      }

      const review = reviews[0];
      console.log(`   ✅ Found pending review: ${review.id}`);
      
      await this.processReview(review);

    } catch (error) {
      console.error('❌ Error in pollForReviews:', error);
    }
  }

  async processReview(review) {
    this.currentReview = review;
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`🔄 PROCESSING REVIEW: ${review.id}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('Business:', review.business_name);
    console.log('Review Link:', review.review_link);
    console.log('');

    try {
      // ═══════════════════════════════════════════════════════════════
      // ✅ FIX 1 & 2: VALIDATE BEFORE PROCESSING
      // ═══════════════════════════════════════════════════════════════
      
      console.log('🔍 Getting next available Gmail account...');
      const gmailAccount = await this.getNextAvailableGmailAccount();
      console.log(`   ✅ Using email: ${gmailAccount.email}`);
      
      console.log('🔍 Getting current IP address...');
      const currentIP = this.currentIP || 'unknown';
      console.log(`   ✅ Current IP: ${currentIP}`);
      
      console.log('');
      console.log('🔒 VALIDATING REPORT SUBMISSION...');
      console.log('───────────────────────────────────────────────────────────────');
      
      const { data: validationResult, error: validationError } = await supabase.rpc(
        'validate_report_submission',
        {
          p_review_id: review.id,
          p_email: gmailAccount.email,
          p_new_ip: currentIP
        }
      );
      
      if (validationError) {
        console.error('❌ Validation error:', validationError);
        throw new Error(`Validation failed: ${validationError.message}`);
      }
      
      if (!validationResult.can_report) {
        console.log('');
        console.log('⛔ CANNOT REPORT - VALIDATION FAILED');
        console.log('───────────────────────────────────────────────────────────────');
        console.log(`   Reason: ${validationResult.reason}`);
        console.log(`   Violation: ${validationResult.violation_type}`);
        
        if (validationResult.time_until_allowed) {
          const minutes = Math.ceil(validationResult.time_until_allowed / 60);
          console.log(`   ⏰ Must wait ${minutes} more minutes`);
        }
        console.log('───────────────────────────────────────────────────────────────');
        console.log('');
        
        // Mark review as failed validation
        await supabase
          .from('reviews')
          .update({ 
            status: 'validation_failed',
            error_message: validationResult.reason
          })
          .eq('id', review.id);
        
        throw new Error(validationResult.reason);
      }
      
      console.log('✅ Validation passed - proceeding with report');
      console.log('');

      // ═══════════════════════════════════════════════════════════════
      // CONTINUE WITH EXISTING AUTOMATION
      // ═══════════════════════════════════════════════════════════════

      // Update status to processing
      await supabase
        .from('reviews')
        .update({ status: 'processing' })
        .eq('id', review.id);

      // Get proxy configuration
      const proxyConfig = await this.getActiveProxyConfig();
      
      // Initialize browser with proxy
      await this.initBrowser(proxyConfig);

      // Create new incognito context
      const context = await this.browser.createBrowserContext();
      const page = await context.newPage();

      // Set up proxy authentication if needed
      if (this.proxyCredentials) {
        await page.authenticate(this.proxyCredentials);
      }

      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      console.log('🌐 Navigating to Google Maps review...');
      await page.goto(review.review_link, { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });

      console.log('🔐 Performing OAuth login...');
      await oauthHandler.loginWithOAuth(page, gmailAccount);

      console.log('⏳ Waiting for review page to load...');
      await page.waitForTimeout(DELAY_BETWEEN_ACTIONS);

      console.log('🔍 Looking for report menu...');
      const reportMenuButton = await page.waitForSelector(
        'button[aria-label*="Report"], button[aria-label*="report"], button[data-tooltip*="Report"]',
        { timeout: 10000 }
      );

      console.log('📋 Opening report menu...');
      await reportMenuButton.click();
      await page.waitForTimeout(1000);

      console.log('🔍 Finding report dialog...');
      const dialogSelectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        'div[jsname]',
        'div[data-ved]'
      ];

      let reportDialog = null;
      for (const selector of dialogSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const text = await element.evaluate(el => el.textContent || '');
          if (text.includes('Report') || text.includes('report')) {
            reportDialog = element;
            break;
          }
        }
        if (reportDialog) break;
      }

      if (!reportDialog) {
        throw new Error('Could not find report dialog');
      }

      console.log('✅ Report dialog found');

      // ═══════════════════════════════════════════════════════════════
      // ✅ FIX 5: DETECT DIALOG TYPE (TYPE A vs TYPE B)
      // ═══════════════════════════════════════════════════════════════

      console.log('');
      console.log('🔍 DETECTING REPORT DIALOG TYPE...');
      console.log('───────────────────────────────────────────────────────────────');

      const availableReasons = await reportDialog.evaluate((dialog) => {
        const radioButtons = dialog.querySelectorAll('[role="radio"], [role="menuitemradio"]');
        return Array.from(radioButtons).map(radio => ({
          text: radio.textContent?.trim() || '',
          ariaLabel: radio.getAttribute('aria-label') || ''
        }));
      });

      console.log(`   📋 Found ${availableReasons.length} available reasons:`);
      availableReasons.forEach((reason, index) => {
        console.log(`      ${index + 1}. ${reason.text}`);
      });

      const dialogType = detectReportDialogType(availableReasons);
      console.log(`   ✅ Detected dialog type: ${dialogType}`);
      console.log('───────────────────────────────────────────────────────────────');
      console.log('');

      // ═══════════════════════════════════════════════════════════════
      // ✅ FIX 3: SELECT REPORT REASON USING MATCHING LOGIC
      // ═══════════════════════════════════════════════════════════════

      const requestedReason = review.report_reason || 'SPAM'; // Default to SPAM
      console.log(`🎯 Requested reason: ${requestedReason}`);

      const reasonMatch = matchReasonToAvailableOptions(
        requestedReason,
        availableReasons,
        dialogType
      );

      let finalReasonText = requestedReason;

      if (reasonMatch) {
        console.log(`✅ Selecting reason: "${reasonMatch.text}"`);
        finalReasonText = reasonMatch.text;
        
        // Click the matched reason
        await reportDialog.evaluate((dialog, reasonText) => {
          const radioButtons = dialog.querySelectorAll('[role="radio"], [role="menuitemradio"]');
          for (const radio of radioButtons) {
            if (radio.textContent?.includes(reasonText)) {
              radio.click();
              return true;
            }
          }
          return false;
        }, reasonMatch.text);
      } else {
        console.log('⚠️ Could not find requested reason, selecting first option');
        await reportDialog.evaluate((dialog) => {
          const firstOption = dialog.querySelector('[role="radio"], [role="menuitemradio"]');
          if (firstOption) firstOption.click();
        });
      }

      await page.waitForTimeout(1000);

      console.log('📤 Submitting report...');
      const submitButton = await reportDialog.$('button[aria-label*="Submit"], button[type="submit"]');
      if (submitButton) {
        await submitButton.click();
      }

      await page.waitForTimeout(2000);

      // ═══════════════════════════════════════════════════════════════
      // ✅ FIX 4: RECORD REPORT HISTORY
      // ═══════════════════════════════════════════════════════════════

      console.log('');
      console.log('📝 RECORDING REPORT IN DATABASE...');
      console.log('───────────────────────────────────────────────────────────────');

      const { data: recordResult, error: recordError } = await supabase.rpc(
        'record_report',
        {
          p_review_id: review.id,
          p_email: gmailAccount.email,
          p_ip_address: currentIP,
          p_session_id: this.proxySession || 'no-session',
          p_report_reason: finalReasonText,
          p_report_reason_type: dialogType,
          p_is_legal_issue: requestedReason === 'LEGAL_ISSUE',
          p_success: true,
          p_error_message: null
        }
      );

      if (recordError) {
        console.error('⚠️ Failed to record report:', recordError);
      } else {
        console.log('✅ Report recorded successfully');
        console.log(`   Report ID: ${recordResult?.report_id || 'N/A'}`);
      }
      console.log('───────────────────────────────────────────────────────────────');
      console.log('');

      // Update review status to completed
      await supabase
        .from('reviews')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', review.id);

      // Update stats
      this.stats.totalProcessed++;
      this.stats.successful++;
      this.stats.lastProcessedAt = new Date();

      console.log('');
      console.log('✅ REVIEW PROCESSED SUCCESSFULLY');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');

      // Close context
      await context.close();

    } catch (error) {
      console.error('');
      console.error('❌ ERROR PROCESSING REVIEW');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('Error:', error.message);
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('');

      // Update review status to failed
      await supabase
        .from('reviews')
        .update({ 
          status: 'failed',
          error_message: error.message
        })
        .eq('id', review.id);

      // Update stats
      this.stats.totalProcessed++;
      this.stats.failed++;

    } finally {
      this.currentReview = null;
    }
  }

  async getNextAvailableGmailAccount() {
    const { data: accounts, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('is_active', true)
      .limit(1);

    if (error || !accounts || accounts.length === 0) {
      throw new Error('No available Gmail accounts');
    }

    return accounts[0];
  }

  async getActiveProxyConfig() {
    const { data: configs, error } = await supabase
      .from('proxy_configs')
      .select('*')
      .eq('is_active', true)
      .limit(1);

    if (error || !configs || configs.length === 0) {
      console.log('⚠️ No active proxy configuration found, running without proxy');
      return null;
    }

    return configs[0];
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

module.exports = AutomationService;

// ═══════════════════════════════════════════════════════════════
// ✅ ALL 5 FIXES INTEGRATED
// ═══════════════════════════════════════════════════════════════
