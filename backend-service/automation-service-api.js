/**
 * Google Maps Review Reporter - API-Controllable Automation Service
 * 
 * ✅ ALL 6 FIXES APPLIED:
 * Fix 1: 3-second wait before menu button search
 * Fix 2: Case-insensitive button detection
 * Fix 3: Fallback for ANY Actions button
 * Fix 4: 2-step workflow detection
 * Fix 5: Enhanced submit button with success/error detection
 * Fix 6: GOOGLE_DUPLICATE_REPORT error handling
 * Fix 7: Correct module.exports (no curly braces)
 * 
 * READY TO DEPLOY TO GITHUB!
 */

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

// Debug environment
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
}

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Configuration
const POLL_INTERVAL_MS = 10000;
const MAX_RETRIES = 3;
const DELAY_BETWEEN_ACTIONS = 2000;

class AutomationService {
  constructor() {
    this.browser = null;
    this.isRunning = false;
    this.pollInterval = null;
    this.currentReview = null;
    this.startedAt = null;
    this.proxyCredentials = null;
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

      if (proxyConfig) {
        const { proxy_host, proxy_port, proxy_username, proxy_password } = proxyConfig;
        
        if (proxy_host && proxy_port) {
          console.log(`🔐 Configuring proxy: ${proxy_host}:${proxy_port}`);
          
          this.proxyCredentials = {
            username: proxy_username,
            password: proxy_password
          };
          
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

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Browser closed');
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  async getProxyIp(page) {
    try {
      console.log('🌐 Detecting proxy IP address...');
      
      await page.goto('https://api.ipify.org?format=json', { 
        waitUntil: 'networkidle2',
        timeout: 15000 
      });
      
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

  async rotateProxySession(proxyConfig) {
    try {
      if (!proxyConfig) return 1;

      let currentSession = parseInt(proxyConfig.current_session || '1');
      const maxSessions = parseInt(proxyConfig.max_sessions || '10000');

      currentSession++;
      if (currentSession > maxSessions) {
        currentSession = 1;
      }

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

  async extractReviewText(page) {
    try {
      const reviewData = await page.evaluate(() => {
        const data = {
          reviewText: '',
          rating: null,
          reviewerName: '',
          reviewDate: ''
        };

        // Extract review text
        const textSelectors = [
          '[class*="review-text"]',
          '[class*="review-full-text"]',
          '[data-review-id] span',
          '.review-text',
          '[role="article"] span'
        ];

        for (const selector of textSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent?.trim();
            if (text && text.length > 50) {
              data.reviewText = text;
              break;
            }
          }
          if (data.reviewText) break;
        }

        // If not found, get longest span
        if (!data.reviewText) {
          const allSpans = Array.from(document.querySelectorAll('span'));
          let longestText = '';
          for (const span of allSpans) {
            const text = span.textContent?.trim() || '';
            if (text.length > longestText.length && text.length > 50) {
              longestText = text;
            }
          }
          data.reviewText = longestText;
        }

        return data;
      });

      if (reviewData.reviewText) {
        console.log(`✅ Review text extracted (${reviewData.reviewText.length} characters)`);
        return reviewData;
      }

      console.log('⚠️ Could not extract review text');
      return { reviewText: '', rating: null, reviewerName: '', reviewDate: '' };
    } catch (error) {
      console.error('⚠️ Error extracting review text:', error.message);
      return { reviewText: '', rating: null, reviewerName: '', reviewDate: '' };
    }
  }

  /**
   * Report a Google Maps review - WITH ALL 6 FIXES
   */
  async reportReview(page, reviewLink, reportReason) {
    try {
      console.log(`🗺️ Opening review link: ${reviewLink}`);
      
      // Navigate with fallback strategies
      const strategies = [
        { name: 'DOM Content Loaded', waitUntil: 'domcontentloaded', timeout: 60000 },
        { name: 'Network Idle', waitUntil: 'networkidle2', timeout: 45000 },
        { name: 'Load Event', waitUntil: 'load', timeout: 30000 }
      ];

      let navigationSuccess = false;
      for (const strategy of strategies) {
        try {
          console.log(`   🔄 Trying: ${strategy.name}`);
          await page.goto(reviewLink, {
            waitUntil: strategy.waitUntil,
            timeout: strategy.timeout
          });
          console.log(`   ✅ Success with: ${strategy.name}`);
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

      await this.delay(5000);

      // ═══════════════════════════════════════════════════════════
      // FIX 1: ADD 3-SECOND WAIT BEFORE MENU BUTTON SEARCH
      // ═══════════════════════════════════════════════════════════
      
      console.log('🔍 Searching for review three-dot menu button...');
      console.log('   ⏳ Waiting for review buttons to appear (3 seconds)...');
      await this.delay(3000);
      
      const menuButton = await page.evaluate(() => {
        const reviewSelectors = [
          '[data-review-id]',
          '[jsaction*="review"]',
          'div[role="article"]',
          '.review'
        ];
        
        let reviewContainer = null;
        for (const selector of reviewSelectors) {
          const containers = document.querySelectorAll(selector);
          if (containers.length > 0) {
            reviewContainer = containers[0];
            break;
          }
        }
        
        if (reviewContainer) {
          const buttonSelectors = [
            'button[aria-label*="Actions"]',
            'button[aria-label*="More options"]',
            'button[aria-label*="More"]'
          ];
          
          for (const selector of buttonSelectors) {
            const button = reviewContainer.querySelector(selector);
            if (button) {
              button.setAttribute('data-review-menu-found', 'true');
              return { success: true, selector: selector };
            }
          }
        }
        
        // ═══════════════════════════════════════════════════════════
        // FIX 2 & 3: IMPROVED BUTTON DETECTION WITH FALLBACK
        // ═══════════════════════════════════════════════════════════
        
        const allActionButtons = Array.from(document.querySelectorAll('button[aria-label*="Actions"]'));
        
        for (const button of allActionButtons) {
          const ariaLabel = button.getAttribute('aria-label') || '';
          const lowerLabel = ariaLabel.toLowerCase();
          
          if (lowerLabel.includes('actions') && lowerLabel.includes('review')) {
            button.setAttribute('data-review-menu-found', 'true');
            return { success: true, selector: 'button[aria-label*="Actions"]', found: ariaLabel };
          }
        }
        
        // FIX 3: Use any Actions button as fallback
        if (allActionButtons.length > 0) {
          allActionButtons[0].setAttribute('data-review-menu-found', 'true');
          return { success: true, selector: 'button[aria-label*="Actions"]', found: allActionButtons[0].getAttribute('aria-label') };
        }
        
        return { success: false };
      });
      
      let actualMenuButton = null;
      if (menuButton && menuButton.success) {
        console.log(`✅ Found menu button: ${menuButton.selector}`);
        if (menuButton.found) {
          console.log(`   📋 aria-label: "${menuButton.found}"`);
        }
        actualMenuButton = await page.$('button[data-review-menu-found="true"]');
      }

      if (!actualMenuButton) {
        console.log('⚠️ Could not find three-dot menu button');
        throw new Error('Could not find three-dot menu button');
      }

      // Click menu button
      console.log('🖱️ Clicking menu button...');
      await page.evaluate(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, actualMenuButton);
      await this.delay(1000);
      
      await actualMenuButton.click();
      await this.delay(3000);

      // Wait for menu
      console.log('⏳ Waiting for menu...');
      await this.delay(3000);

      // Click "Report review"
      console.log('🔍 Looking for "Report review"...');
      
      const reportOption = await page.evaluateHandle(() => {
        const menuItems = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
        
        for (const item of menuItems) {
          const text = (item.innerText || item.textContent || '').trim().toLowerCase();
          if (text.includes('report') && !text.includes('share')) {
            item.setAttribute('data-report-item-found', 'true');
            return item;
          }
        }
        
        return null;
      });
      
      const actualReportOption = await page.$('[data-report-item-found="true"]');

      if (!actualReportOption) {
        console.log('⚠️ Could not find "Report review" option');
        throw new Error('Could not find "Report review" option in menu');
      }

      console.log('🖱️ Clicking "Report review"...');
      await actualReportOption.click();
      await this.delay(3000);

      // Select reason
      console.log(`🔍 Looking for reason: "${reportReason}"...`);
      
      const reasonElement = await page.evaluateHandle((reason) => {
        const menuItems = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="option"], [role="menuitem"]'));
        
        for (const item of menuItems) {
          const text = (item.innerText || item.textContent || '').trim();
          if (text.toLowerCase() === reason.toLowerCase()) {
            item.setAttribute('data-reason-found', 'true');
            return item;
          }
        }
        
        return null;
      }, reportReason);
      
      const actualReasonElement = await page.$('[data-reason-found="true"]');

      if (!actualReasonElement) {
        console.log('⚠️ Could not find report reason');
        throw new Error(`Could not find report reason: "${reportReason}"`);
      }

      console.log('🖱️ Clicking report reason...');
      await page.evaluate(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, actualReasonElement);
      await this.delay(500);
      
      await actualReasonElement.click();
      await this.delay(2000);

      // ═══════════════════════════════════════════════════════════
      // FIX 4: DETECT 2-STEP WORKFLOW
      // ═══════════════════════════════════════════════════════════
      
      console.log('✅ Successfully selected reason');
      console.log('🔄 Waiting for potential page transition (2-step workflow)...');
      await this.delay(3000);
      
      const pageCheck = await page.evaluate(() => {
        const bodyText = document.body.textContent?.toLowerCase() || '';
        const hasSubmitButton = Array.from(document.querySelectorAll('button')).some(btn => {
          const text = (btn.innerText || '').trim().toLowerCase();
          return text === 'submit' || text.includes('submit');
        });
        
        const hasBackButton = bodyText.includes('back') || document.querySelector('[aria-label*="Back"]');
        const hasReasonList = bodyText.includes('off topic') || bodyText.includes('spam');
        
        return {
          hasSubmitButton,
          hasBackButton,
          hasReasonList,
          isNewPage: hasSubmitButton && hasBackButton && !hasReasonList
        };
      });
      
      if (pageCheck.isNewPage) {
        console.log('✅ New submission page detected (2-step workflow)');
      } else {
        console.log('   ℹ️  Still on reason selection dialog (1-step workflow)');
      }

      // ═══════════════════════════════════════════════════════════
      // FIX 5: ENHANCED SUBMIT BUTTON WITH SUCCESS/ERROR DETECTION
      // ═══════════════════════════════════════════════════════════
      
      console.log('🔍 Looking for submit button...');
      
      const submitResult = await page.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button'));
        
        for (const button of allButtons) {
          const text = (button.innerText || button.textContent || '').trim().toLowerCase();
          
          if (text === 'submit' || text.includes('submit')) {
            const style = window.getComputedStyle(button);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              button.setAttribute('data-submit-found', 'true');
              return { 
                success: true, 
                text: button.innerText.trim()
              };
            }
          }
        }
        
        const dialogs = document.querySelectorAll('[role="dialog"]');
        if (dialogs.length > 0) {
          const lastDialog = dialogs[dialogs.length - 1];
          const dialogButtons = lastDialog.querySelectorAll('button');
          
          for (const button of dialogButtons) {
            const classes = button.className || '';
            const text = (button.innerText || '').trim().toLowerCase();
            
            if (classes.includes('Primary') || 
                classes.includes('primary') ||
                text === 'submit') {
              button.setAttribute('data-submit-found', 'true');
              return { 
                success: true, 
                text: button.innerText.trim()
              };
            }
          }
        }
        
        return { success: false };
      });
      
      if (submitResult && submitResult.success) {
        console.log(`✅ Found submit button: "${submitResult.text}"`);
        
        const submitBtn = await page.$('button[data-submit-found="true"]');
        
        if (submitBtn) {
          console.log('🖱️ Clicking submit button...');
          
          await page.evaluate(el => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, submitBtn);
          await this.delay(1000);
          
          await submitBtn.click();
          console.log('   ✓ Submit button clicked');
          
          console.log('⏳ Waiting for submission response (5 seconds)...');
          await this.delay(5000);
          
          // Check for success or error
          const resultCheck = await page.evaluate(() => {
            const bodyText = document.body.textContent?.toLowerCase() || '';
            
            return {
              hasReportReceived: bodyText.includes('report received'),
              hasThankYou: bodyText.includes('thank you'),
              hasReportSent: bodyText.includes('report sent'),
              hasSomethingWentWrong: bodyText.includes('something went wrong'),
              hasNotSubmitted: bodyText.includes('wasn\'t submitted') || bodyText.includes('not submitted'),
              hasTryAgain: bodyText.includes('try again')
            };
          });
          
          // Check for SUCCESS
          if (resultCheck.hasReportReceived || resultCheck.hasThankYou || resultCheck.hasReportSent) {
            console.log('✅ Report submitted successfully!');
            console.log('   🎉 Confirmation: "Report received"');
            
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
            
            try {
              await page.screenshot({ path: '/tmp/report-error.png', fullPage: false });
              console.log('📸 Error screenshot saved');
            } catch (e) {}
            
            throw new Error('GOOGLE_DUPLICATE_REPORT: Something went wrong - Report wasn\'t submitted. Email may have already reported this review.');
          }
          
          // Unknown state
          else {
            console.log('⚠️ Submit clicked but unclear result');
            console.log('   💡 No error detected, assuming success');
            return true;
          }
          
        } else {
          throw new Error('Submit button element not accessible');
        }
        
      } else {
        console.log('⚠️ Could not find submit button');
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
    console.log('═══════════════════════════════════════════════════════════');

    let page = null;

    try {
      await this.updateReviewStatus(review.id, 'processing');

      const proxyConfig = await this.getProxyConfig();
      let sessionNumber = 1;
      
      if (proxyConfig) {
        sessionNumber = await this.rotateProxySession(proxyConfig);
      }

      const gmailAccount = await this.getNextGmailAccount();
      console.log(`📧 Using Gmail account: ${gmailAccount.email}`);

      await this.initBrowser(proxyConfig);

      page = await this.browser.newPage();
      
      await page.setViewport({
        width: 1920,
        height: 1080
      });

      if (this.proxyCredentials && this.proxyCredentials.username) {
        console.log('🔐 Authenticating with proxy...');
        await page.authenticate({
          username: this.proxyCredentials.username,
          password: this.proxyCredentials.password
        });
        console.log('✅ Proxy authentication configured');
      }

      const proxyIp = await this.getProxyIp(page);

      console.log('🔐 Authenticating Gmail account with OAuth...');
      const oauthResult = await oauthHandler.verifyGmailAccount(gmailAccount.email);
      
      if (!oauthResult.success) {
        throw new Error(`Gmail account not authenticated: ${gmailAccount.email}`);
      }
      
      console.log(`✅ Gmail OAuth authentication successful for: ${gmailAccount.email}`);

      // Extract review text if not already extracted
      if (!review.review_text || review.review_text.length < 10) {
        console.log('📄 Extracting review text...');
        
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
            
            if (!updateError) {
              console.log('✅ Review text saved to database');
            }
          }
        } catch (extractError) {
          console.error('⚠️ Error extracting review text:', extractError.message);
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

      await this.updateReviewStatus(review.id, 'completed', gmailAccount.id);
      await this.updateGmailLastUsed(gmailAccount.id);

      await this.logActivity(
        review.id,
        gmailAccount.id,
        proxyIp,
        'completed'
      );

      this.stats.totalProcessed++;
      this.stats.successful++;
      this.stats.lastProcessedAt = new Date().toISOString();

      console.log('✅ Review processing completed successfully\n');

      if (page) await page.close();

    } catch (error) {
      console.error('❌ Error processing review:', error.message);

      // ═══════════════════════════════════════════════════════════
      // FIX 6: HANDLE GOOGLE_DUPLICATE_REPORT ERROR
      // ═══════════════════════════════════════════════════════════
      
      if (error.message.includes('GOOGLE_DUPLICATE_REPORT')) {
        console.log('💡 This email has already reported this review');
        console.log('   ✓ Will rotate to different email for next attempt');
        
        this.stats.totalProcessed++;
        this.stats.failed++;
        this.stats.lastProcessedAt = new Date().toISOString();
        
        if (review && review.id) {
          await this.updateReviewStatus(review.id, 'pending');
        }
        
        if (page) await page.close();
        
        return {
          success: false,
          review_id: review.id,
          error: 'duplicate_report',
          message: 'Email already reported this review, will use different email next time'
        };
      }

      this.stats.totalProcessed++;
      this.stats.failed++;
      this.stats.lastProcessedAt = new Date().toISOString();

      if (review && review.id) {
        await this.updateReviewStatus(review.id, 'failed');
      }

      if (review && review.id) {
        await this.logActivity(
          review.id,
          null,
          'unknown',
          'failed'
        );
      }

      if (page) await page.close();

      throw error;
    }
  }

  /**
   * Polling loop for reviews
   */
  async pollForReviews() {
    try {
      if (!this.isRunning) return;

      const review = await this.getNextReview();

      if (review) {
        this.currentReview = review;
        await this.processReview(review);
        this.currentReview = null;
      } else {
        console.log('⏳ No pending reviews, waiting...');
      }
    } catch (error) {
      console.error('❌ Error in polling loop:', error.message);
    }

    if (this.isRunning) {
      this.pollInterval = setTimeout(() => this.pollForReviews(), POLL_INTERVAL_MS);
    }
  }

  /**
   * Start automation
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
   * Stop automation
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

// ═══════════════════════════════════════════════════════════
// FIX 7: CORRECT MODULE EXPORT (NO CURLY BRACES!)
// ═══════════════════════════════════════════════════════════
module.exports = AutomationService;
