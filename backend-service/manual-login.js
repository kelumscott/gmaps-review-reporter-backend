/**
 * Manual Login Script
 * Run this ONCE per Gmail account to save login session to database
 * 
 * Usage:
 *   node manual-login.js youremail@gmail.com
 * 
 * This will:
 * 1. Open a browser window
 * 2. Navigate to Google login
 * 3. Wait for you to manually log in
 * 4. Extract and save session cookies to Supabase
 * 5. Future automations will reuse these cookies
 */

const puppeteer = require('puppeteer');
const SessionManager = require('./session-manager');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function manualLogin() {
  const email = process.argv[2];
  
  if (!email) {
    console.error('');
    console.error('❌ ERROR: Email required');
    console.error('');
    console.error('Usage:');
    console.error('  node manual-login.js youremail@gmail.com');
    console.error('');
    process.exit(1);
  }
  
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('🔐 MANUAL LOGIN SCRIPT');
  console.log('════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`📧 Email: ${email}`);
  console.log('');
  console.log('This will:');
  console.log('  1. Open a browser window');
  console.log('  2. Navigate to Google login');
  console.log('  3. Wait for YOU to manually log in');
  console.log('  4. Extract and save session cookies');
  console.log('  5. Future automations will reuse these cookies');
  console.log('');
  console.log('⚠️  IMPORTANT: You will manually log in with password');
  console.log('');
  
  const sessionManager = new SessionManager();
  let browser;
  
  try {
    console.log('🌐 Launching browser...');
    browser = await puppeteer.launch({
      headless: false, // Show browser so you can log in
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set a real user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('✅ Browser launched');
    console.log('');
    console.log('🔐 Navigating to Google login...');
    
    // Navigate to Google login
    await page.goto('https://accounts.google.com/signin', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    console.log('✅ Google login page opened');
    console.log('');
    console.log('════════════════════════════════════════════════════════════');
    console.log('⚠️  ACTION REQUIRED: Log in to Google in the browser window');
    console.log('════════════════════════════════════════════════════════════');
    console.log('');
    console.log('Steps:');
    console.log(`  1. Enter email: ${email}`);
    console.log('  2. Click "Next"');
    console.log('  3. Enter password');
    console.log('  4. Click "Next"');
    console.log('  5. Complete any 2FA if prompted');
    console.log('  6. Wait until you see your Google Account page');
    console.log('');
    console.log('Once logged in, come back here and press ENTER');
    console.log('');
    
    // Wait for user to finish logging in
    await askQuestion('Press ENTER when you are logged in... ');
    
    console.log('');
    console.log('🔍 Verifying login...');
    
    // Verify login
    const isLoggedIn = await sessionManager.verifyGoogleLogin(page);
    
    if (!isLoggedIn) {
      console.error('');
      console.error('❌ Login verification failed!');
      console.error('');
      console.error('Please:');
      console.error('  1. Make sure you completed the login');
      console.error('  2. Check you\'re on the Google Account page');
      console.error('  3. Try again');
      console.error('');
      await browser.close();
      rl.close();
      process.exit(1);
    }
    
    console.log('✅ Login verified successfully!');
    console.log('');
    console.log('💾 Extracting and saving session cookies...');
    
    // Extract cookies
    const cookies = await sessionManager.extractCookies(page);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    
    // Save to database
    const saved = await sessionManager.saveCookies(email, cookies, userAgent);
    
    if (!saved) {
      console.error('');
      console.error('❌ Failed to save cookies to database');
      console.error('');
      console.error('Please check:');
      console.error('  1. Supabase connection is working');
      console.error('  2. browser_sessions table exists');
      console.error('  3. Run: /⚡_CREATE_BROWSER_SESSIONS_TABLE.sql');
      console.error('');
      await browser.close();
      rl.close();
      process.exit(1);
    }
    
    console.log('');
    console.log('════════════════════════════════════════════════════════════');
    console.log('✅ SUCCESS!');
    console.log('════════════════════════════════════════════════════════════');
    console.log('');
    console.log('Session cookies saved to database!');
    console.log('');
    console.log('Details:');
    console.log(`  📧 Email: ${email}`);
    console.log(`  🍪 Cookies saved: ${cookies.length}`);
    console.log(`  🌐 User agent: ${userAgent.substring(0, 60)}...`);
    console.log(`  ⏰ Valid for: ~30 days`);
    console.log('');
    console.log('What happens next:');
    console.log('  ✅ Automation will automatically use these cookies');
    console.log('  ✅ Browser will be logged in as this account');
    console.log('  ✅ No more "Unavailable" dialog!');
    console.log('  ✅ Sessions auto-refresh when needed');
    console.log('');
    console.log('You can close the browser now.');
    console.log('');
    
    await browser.close();
    rl.close();
    
  } catch (error) {
    console.error('');
    console.error('❌ ERROR:', error.message);
    console.error('');
    if (browser) {
      await browser.close();
    }
    rl.close();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  manualLogin();
}

module.exports = manualLogin;
