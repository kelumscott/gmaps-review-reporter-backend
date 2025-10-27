/**
 * Browser Session Manager
 * Manages persistent Google login sessions using cookies stored in Supabase
 * Works on Render free tier (no disk storage needed)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

class SessionManager {
  /**
   * Save browser cookies to database
   */
  async saveCookies(email, cookies, userAgent) {
    try {
      console.log(`💾 Saving session cookies for ${email}...`);
      
      // Calculate expiration (cookies typically expire in 30 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      const { data, error } = await supabase
        .from('browser_sessions')
        .upsert({
          gmail_account: email,
          cookies: cookies,
          user_agent: userAgent,
          last_used_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          is_valid: true,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'gmail_account'
        })
        .select()
        .single();
      
      if (error) {
        console.error('❌ Failed to save cookies:', error.message);
        return false;
      }
      
      console.log(`✅ Session cookies saved (${cookies.length} cookies)`);
      return true;
      
    } catch (error) {
      console.error('❌ Error saving cookies:', error.message);
      return false;
    }
  }
  
  /**
   * Load browser cookies from database
   */
  async loadCookies(email) {
    try {
      console.log(`📥 Loading session cookies for ${email}...`);
      
      const { data, error } = await supabase
        .from('browser_sessions')
        .select('*')
        .eq('gmail_account', email)
        .eq('is_valid', true)
        .single();
      
      if (error) {
        console.log(`   ⚠️ No saved session found for ${email}`);
        return null;
      }
      
      // Check if session expired
      const expiresAt = new Date(data.expires_at);
      if (expiresAt < new Date()) {
        console.log(`   ⚠️ Session expired (expired at ${expiresAt})`);
        await this.invalidateSession(email);
        return null;
      }
      
      console.log(`✅ Loaded ${data.cookies.length} cookies`);
      console.log(`   Last used: ${new Date(data.last_used_at).toLocaleString()}`);
      console.log(`   Expires: ${expiresAt.toLocaleString()}`);
      
      // Update last used time
      await supabase
        .from('browser_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('gmail_account', email);
      
      return data.cookies;
      
    } catch (error) {
      console.error('❌ Error loading cookies:', error.message);
      return null;
    }
  }
  
  /**
   * Invalidate a session
   */
  async invalidateSession(email) {
    try {
      await supabase
        .from('browser_sessions')
        .update({ is_valid: false })
        .eq('gmail_account', email);
      
      console.log(`❌ Session invalidated for ${email}`);
      return true;
      
    } catch (error) {
      console.error('❌ Error invalidating session:', error.message);
      return false;
    }
  }
  
  /**
   * Restore cookies to browser page
   */
  async restoreCookies(page, cookies) {
    try {
      console.log(`🍪 Restoring ${cookies.length} cookies to browser...`);
      
      // Set each cookie
      for (const cookie of cookies) {
        await page.setCookie(cookie);
      }
      
      console.log('✅ Cookies restored to browser');
      return true;
      
    } catch (error) {
      console.error('❌ Error restoring cookies:', error.message);
      return false;
    }
  }
  
  /**
   * Get all cookies from browser page
   */
  async extractCookies(page) {
    try {
      const cookies = await page.cookies();
      console.log(`📤 Extracted ${cookies.length} cookies from browser`);
      return cookies;
      
    } catch (error) {
      console.error('❌ Error extracting cookies:', error.message);
      return [];
    }
  }
  
  /**
   * Verify if browser is logged into Google
   */
  async verifyGoogleLogin(page) {
    try {
      console.log('🔍 Verifying Google login status...');
      
      // Navigate to Google account page
      await page.goto('https://myaccount.google.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      await this.delay(2000);
      
      // Check if logged in
      const loginStatus = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const hasSignIn = bodyText.includes('Sign in') || bodyText.includes('Sign In');
        const hasCreateAccount = bodyText.includes('Create account');
        const hasGoogleAccount = bodyText.includes('Google Account');
        
        // Get email if visible
        const emailElement = document.querySelector('[data-email], [aria-label*="email"]');
        const email = emailElement ? emailElement.textContent.trim() : null;
        
        return {
          isLoggedIn: !hasSignIn && !hasCreateAccount && hasGoogleAccount,
          hasSignIn,
          hasCreateAccount,
          hasGoogleAccount,
          email,
          pageTitle: document.title,
          url: window.location.href
        };
      });
      
      console.log('   Login status:', JSON.stringify(loginStatus, null, 2));
      
      if (loginStatus.isLoggedIn) {
        console.log(`✅ Logged in to Google${loginStatus.email ? ` as ${loginStatus.email}` : ''}`);
        return true;
      } else {
        console.log('❌ Not logged in to Google');
        return false;
      }
      
    } catch (error) {
      console.error('❌ Error verifying login:', error.message);
      return false;
    }
  }
  
  /**
   * Helper: Delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = SessionManager;
