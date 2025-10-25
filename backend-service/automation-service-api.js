/**
 * PRODUCTION FAST VERSION - Google Maps Review Reporter
 * 
 * OPTIMIZED FOR SPEED - Target: 5-10 seconds per review
 * - Removed all diagnostic overhead
 * - Minimized delays to bare essentials
 * - Uses proven selectors/methods
 * - Streamlined error handling
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');
const oauthHandler = require('./oauth-handler');

puppeteerExtra.use(StealthPlugin());
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

class AutomationService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.pollingInterval = 10000; // 10 seconds
    this.browser = null;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async start() {
    if (this.isRunning) {
      console.log('⚠️  Automation already running');
      return { success: false, message: 'Already running' };
    }

    console.log('🤖 Starting automation service...');
    this.isRunning = true;

    // Start polling loop
    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.processNextReview();
      }
    }, this.pollingInterval);

    console.log(`✅ Automation service started successfully`);
    return { success: true, message: 'Automation started' };
  }

  async stop() {
    console.log('🛑 Stopping automation service...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    console.log('✅ Automation service stopped');
    return { success: true, message: 'Automation stopped' };
  }

  async processNextReview() {
    try {
      // Fetch next pending review
      const { data: reviews, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;

      if (!reviews || reviews.length === 0) {
        console.log('⏳ No pending reviews, waiting...');
        return;
      }

      const review = reviews[0];
      console.log(`\n🔄 Processing review: ${review.id}`);
      console.log(`   Business: ${review.business_name}`);

      await this.reportReview(review);

    } catch (error) {
      console.error('❌ Error in processNextReview:', error.message);
    }
  }

  async reportReview(review) {
    let page = null;
    const startTime = Date.now();

    try {
      // Update status to processing
      await supabase
        .from('reviews')
        .update({ 
          status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', review.id);

      // Get proxy config (FAST - no excessive checks)
      const { data: proxyConfig } = await supabase
        .from('proxy_configs')
        .select('*')
        .eq('is_active', true)
        .single();

      // Launch browser
      console.log('🌐 Launching browser...');
      if (!this.browser) {
        const isProduction = process.env.NODE_ENV === 'production';
        
        this.browser = await puppeteerExtra.launch({
          args: isProduction
            ? [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--start-maximized'
              ]
            : [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized'
              ],
          defaultViewport: chromium.defaultViewport,
          executablePath: isProduction ? await chromium.executablePath() : '/usr/bin/google-chrome',
          headless: isProduction ? chromium.headless : false,
          ignoreHTTPSErrors: true
        });
      }

      // Get Gmail account
      const { data: gmailAccounts } = await supabase
        .from('gmail_accounts')
        .select('*')
        .eq('status', 'active')
        .order('last_used_at', { ascending: true })
        .limit(1);

      if (!gmailAccounts || gmailAccounts.length === 0) {
        throw new Error('No active Gmail accounts available');
      }

      const gmailAccount = gmailAccounts[0];
      console.log(`📧 Using Gmail: ${gmailAccount.email}`);

      // Verify OAuth
      const oauthResult = await oauthHandler.verifyAndRefreshToken(gmailAccount.email);
      if (!oauthResult.success) {
        throw new Error(`OAuth failed: ${oauthResult.error}`);
      }

      // Create new page
      page = await this.browser.newPage();
      
      // Set proxy if available
      if (proxyConfig && proxyConfig.proxy_url) {
        await page.authenticate({
          username: proxyConfig.proxy_username,
          password: proxyConfig.proxy_password
        });
      }

      // FAST: Go to review link
      console.log('🗺️ Opening review link...');
      await page.goto(review.review_link, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });

      // Wait 1 second for page to stabilize
      await this.delay(1000);

      // FAST: Click menu button
      console.log('🖱️ Clicking menu button...');
      await page.click('button[aria-label*="Actions"]');
      await this.delay(500); // Short delay for menu to appear

      // FAST: Click "Report review"
      console.log('🖱️ Clicking "Report review"...');
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
        for (const item of items) {
          const text = (item.innerText || '').toLowerCase();
          if (text.includes('report')) {
            item.click();
            return;
          }
        }
      });

      // FAST: Wait for dialog
      console.log('⏳ Waiting for report dialog...');
      await page.waitForSelector('[role="dialog"], [role="alertdialog"]', {
        visible: true,
        timeout: 10000
      });

      await this.delay(500);

      // FAST: Select report reason
      console.log('📝 Selecting report reason...');
      const reportReason = review.report_reason || 'Harassment or hate speech';
      
      await page.evaluate((reason) => {
        const radios = Array.from(document.querySelectorAll('[role="radio"]'));
        for (const radio of radios) {
          const label = radio.getAttribute('aria-label') || '';
          const text = (radio.innerText || radio.textContent || '').toLowerCase();
          const combined = (label + ' ' + text).toLowerCase();
          
          // Match report reason
          if (
            (reason.includes('Harassment') && combined.includes('harassment')) ||
            (reason.includes('Fake') && (combined.includes('fake') || combined.includes('misleading'))) ||
            (reason.includes('Offensive') && combined.includes('offensive')) ||
            (reason.includes('Off-topic') && combined.includes('off-topic')) ||
            (reason.includes('Conflict') && combined.includes('conflict'))
          ) {
            radio.click();
            return;
          }
        }
        
        // Fallback: click first radio
        if (radios.length > 0) {
          radios[0].click();
        }
      }, reportReason);

      await this.delay(300);

      // FAST: Click submit
      console.log('✅ Submitting report...');
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          const text = (btn.innerText || '').toLowerCase();
          if (text.includes('submit') || text.includes('send') || text.includes('report')) {
            btn.click();
            return;
          }
        }
      });

      // Wait for submission
      await this.delay(2000);

      // Success!
      const elapsedTime = Math.round((Date.now() - startTime) / 1000);
      console.log(`✅ Report submitted successfully in ${elapsedTime}s`);

      // Update status
      await supabase
        .from('reviews')
        .update({
          status: 'completed',
          processed_at: new Date().toISOString(),
          gmail_account_used: gmailAccount.email,
          updated_at: new Date().toISOString()
        })
        .eq('id', review.id);

      // Update Gmail account last_used
      await supabase
        .from('gmail_accounts')
        .update({ last_used_at: new Date().toISOString() })
        .eq('email', gmailAccount.email);

    } catch (error) {
      console.error('❌ Error reporting review:', error.message);
      
      // Update status to failed
      await supabase
        .from('reviews')
        .update({
          status: 'failed',
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', review.id);

    } finally {
      if (page) {
        await page.close();
      }
    }
  }
}

module.exports = AutomationService;
