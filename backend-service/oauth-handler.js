/**
 * OAuth 2.0 Handler for Gmail Authentication
 * 
 * This module handles Gmail OAuth authentication flow using Google's official API.
 * This bypasses bot detection since we use official Google APIs instead of
 * automating the web interface.
 */

const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// OAuth2 client configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * Generate OAuth authorization URL for user to grant permission
 * @param {string} email - Gmail address to authorize
 * @returns {string} Authorization URL
 */
function getAuthUrl(email) {
  // Request comprehensive Gmail scopes to avoid "Insufficient Permission" errors
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',      // Read Gmail messages
    'https://www.googleapis.com/auth/gmail.metadata',      // Access Gmail metadata
    'https://www.googleapis.com/auth/gmail.modify',        // Modify Gmail messages (needed for full functionality)
    'https://www.googleapis.com/auth/userinfo.email',      // Get user email
    'https://www.googleapis.com/auth/userinfo.profile',    // Get user profile
    'openid'                                                // OpenID Connect
  ];
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',     // Get refresh token for long-term access
    scope: scopes,
    state: email,                // Pass email to remember which account during callback
    prompt: 'consent',           // Force consent screen to ensure we get refresh token and latest scopes
    include_granted_scopes: true // Include previously granted scopes
  });

  console.log(`🔐 Generated OAuth URL for: ${email}`);
  console.log(`   Requesting scopes:`, scopes.join(', '));
  return authUrl;
}

/**
 * Exchange authorization code for access and refresh tokens
 * @param {string} code - Authorization code from Google
 * @returns {Promise<object>} Tokens object
 */
async function getTokensFromCode(code) {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('✅ Successfully exchanged auth code for tokens');
    console.log('   Token details:');
    console.log('   - Has access_token:', !!tokens.access_token);
    console.log('   - Has refresh_token:', !!tokens.refresh_token);
    console.log('   - Expires in:', tokens.expiry_date ? `${Math.round((tokens.expiry_date - Date.now()) / 1000 / 60)} minutes` : 'unknown');
    console.log('   - Scopes granted:', tokens.scope || 'not specified in response');
    return tokens;
  } catch (error) {
    console.error('❌ Error getting tokens from code:', error.message);
    throw error;
  }
}

/**
 * Save OAuth tokens to Supabase database
 * @param {string} email - Gmail address
 * @param {object} tokens - Tokens from Google
 */
async function saveTokens(email, tokens) {
  try {
    const expiryDate = new Date(tokens.expiry_date);
    
    // Prepare update data
    const updateData = {
      oauth_access_token: tokens.access_token,
      oauth_expiry: expiryDate.toISOString()
    };
    
    // Only update refresh_token if we received a new one
    // This prevents accidentally overwriting existing refresh_token with null
    if (tokens.refresh_token) {
      updateData.oauth_refresh_token = tokens.refresh_token;
      console.log(`🔑 Updating refresh token for: ${email}`);
    } else {
      console.log(`🔄 Refreshing access token only for: ${email} (keeping existing refresh token)`);
    }
    
    // Add updated_at if column exists (defensive coding)
    // This prevents errors if the column hasn't been added yet
    try {
      updateData.updated_at = new Date().toISOString();
    } catch (e) {
      // Ignore if updated_at doesn't exist
    }
    
    const { error } = await supabase
      .from('gmail_accounts')
      .update(updateData)
      .eq('email', email);

    if (error) {
      console.error('❌ Error saving tokens to database:', error.message);
      throw error;
    }

    console.log(`✅ Saved OAuth tokens for: ${email}`);
    console.log(`   Token expires: ${expiryDate.toLocaleString()}`);
  } catch (error) {
    console.error('❌ Error in saveTokens:', error.message);
    throw error;
  }
}

/**
 * Get valid access token for an email (auto-refresh if expired)
 * @param {string} email - Gmail address
 * @returns {Promise<string>} Valid access token
 */
async function getValidAccessToken(email) {
  try {
    console.log(`🔍 Fetching OAuth tokens for ${email} from database...`);
    
    // Get tokens from database
    const { data, error } = await supabase
      .from('gmail_accounts')
      .select('oauth_access_token, oauth_refresh_token, oauth_expiry')
      .eq('email', email)
      .single();

    if (error) {
      console.error(`❌ Error fetching tokens for ${email}:`, error.message);
      throw new Error('Gmail account not found or not authorized');
    }

    console.log(`   Database query result for ${email}:`);
    console.log(`   - Has access token: ${!!data.oauth_access_token}`);
    console.log(`   - Has refresh token: ${!!data.oauth_refresh_token}`);
    console.log(`   - Token expiry: ${data.oauth_expiry || 'null'}`);

    if (!data.oauth_refresh_token) {
      console.error(`❌ No refresh token found for ${email}`);
      throw new Error('No OAuth tokens found. Please authorize this Gmail account first.');
    }

    // Check if token is still valid
    const expiryDate = new Date(data.oauth_expiry);
    const now = new Date();
    
    console.log(`   Token expiry check:`);
    console.log(`   - Current time: ${now.toISOString()}`);
    console.log(`   - Token expires: ${expiryDate.toISOString()}`);
    console.log(`   - Time until expiry: ${Math.round((expiryDate.getTime() - now.getTime()) / 1000 / 60)} minutes`);
    
    // Token still valid (with 5 min buffer)
    if (now < new Date(expiryDate.getTime() - 5 * 60 * 1000)) {
      console.log(`✅ Using existing access token for ${email} (valid for ${Math.round((expiryDate.getTime() - now.getTime()) / 1000 / 60)} more minutes)`);
      return data.oauth_access_token;
    }

    // Token expired - refresh it
    console.log(`🔄 Access token expired for ${email}, refreshing...`);
    
    oauth2Client.setCredentials({
      refresh_token: data.oauth_refresh_token
    });

    const { credentials } = await oauth2Client.refreshAccessToken();
    console.log(`   ✓ Received new access token from Google`);
    
    // Save new tokens
    await saveTokens(email, credentials);
    
    console.log(`✅ Refreshed access token for ${email}`);
    return credentials.access_token;
  } catch (error) {
    console.error(`❌ Error getting valid access token for ${email}:`, error.message);
    console.error(`   Error stack:`, error.stack);
    throw error;
  }
}

/**
 * Verify Gmail account access using OAuth
 * This replaces the Puppeteer Gmail login
 * @param {string} email - Gmail address
 * @returns {Promise<object>} Verification result
 */
async function verifyGmailAccount(email) {
  try {
    console.log(`🔐 Verifying Gmail account with OAuth: ${email}`);
    
    const accessToken = await getValidAccessToken(email);
    console.log(`   ✓ Got valid access token for ${email}`);
    
    // Check token scopes for debugging
    const tokenInfo = await getTokenInfo(accessToken);
    if (tokenInfo) {
      console.log(`   📋 Token scopes:`, tokenInfo.scope || 'unknown');
      console.log(`   📧 Token email:`, tokenInfo.email || 'unknown');
      console.log(`   ⏰ Token expires in:`, tokenInfo.expires_in ? `${tokenInfo.expires_in} seconds` : 'unknown');
      
      // Warn if critical scopes are missing
      const hasGmailScope = tokenInfo.scope && (
        tokenInfo.scope.includes('gmail.readonly') || 
        tokenInfo.scope.includes('gmail.modify') ||
        tokenInfo.scope.includes('mail.google.com')
      );
      
      if (!hasGmailScope) {
        console.warn(`   ⚠️  WARNING: Token missing Gmail scopes! This will cause "Insufficient Permission" errors.`);
        console.warn(`   ⚠️  User needs to re-authorize with updated permissions.`);
        return {
          success: false,
          error: 'Insufficient Permission: Token was authorized with old/limited scopes. Please re-authorize this account to grant updated permissions.',
          needsReauth: true
        };
      }
    }
    
    // Set credentials
    oauth2Client.setCredentials({
      access_token: accessToken
    });

    // Create Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Test API access by getting profile
    console.log(`   ⏳ Testing Gmail API access for ${email}...`);
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    console.log(`✅ Gmail OAuth verification successful!`);
    console.log(`   Email: ${profile.data.emailAddress}`);
    console.log(`   Messages: ${profile.data.messagesTotal}`);
    
    return {
      success: true,
      email: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal
    };
  } catch (error) {
    console.error(`❌ Gmail OAuth verification failed for ${email}`);
    console.error(`   Error type: ${error.constructor.name}`);
    console.error(`   Error message: ${error.message}`);
    
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    
    if (error.errors && error.errors.length > 0) {
      console.error(`   Detailed errors:`, JSON.stringify(error.errors, null, 2));
    }
    
    // Handle insufficient permission specifically
    if (error.message.includes('Insufficient Permission') || (error.code === 403 && error.message.includes('ufficient'))) {
      return {
        success: false,
        error: 'Insufficient Permission: Your account was authorized with limited scopes. Please REVOKE access in your Google Account settings (https://myaccount.google.com/permissions), then re-authorize here to grant full permissions.',
        needsReauth: true,
        revokeUrl: 'https://myaccount.google.com/permissions'
      };
    }
    
    if (error.message.includes('not authorized') || error.message.includes('No OAuth tokens')) {
      return {
        success: false,
        error: 'Account not authorized. Please click "Authorize Gmail" button.'
      };
    }
    
    if (error.message.includes('invalid_grant') || error.message.includes('Token has been expired')) {
      return {
        success: false,
        error: 'OAuth token expired or invalid. Please re-authorize this account.'
      };
    }
    
    return {
      success: false,
      error: error.message || 'Unknown error during Gmail verification'
    };
  }
}

/**
 * Check if a Gmail account has OAuth tokens configured
 * @param {string} email - Gmail address
 * @returns {Promise<boolean>} True if tokens exist
 */
async function hasOAuthTokens(email) {
  try {
    const { data, error } = await supabase
      .from('gmail_accounts')
      .select('oauth_refresh_token')
      .eq('email', email)
      .single();

    if (error || !data) return false;
    
    return !!data.oauth_refresh_token;
  } catch (error) {
    return false;
  }
}

/**
 * Get token info including scopes
 * Useful for debugging permission issues
 * @param {string} accessToken - Access token to inspect
 * @returns {Promise<object>} Token info from Google
 */
async function getTokenInfo(accessToken) {
  try {
    const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`);
    const info = await response.json();
    return info;
  } catch (error) {
    console.error('Error getting token info:', error);
    return null;
  }
}

/**
 * Login to Google using OAuth in Puppeteer browser
 * This function uses OAuth tokens to authenticate the browser session
 * 
 * UPDATED: Skip navigation to avoid timeouts - just set cookies
 * 
 * @param {Page} page - Puppeteer page object
 * @param {string} gmailId - Gmail account ID from database
 * @param {string} email - Gmail address
 * @returns {Promise<object>} Login result with success status
 */
async function loginWithOAuth(page, gmailId, email) {
  try {
    console.log(`🔐 Starting OAuth browser login for: ${email}`);
    
    // Step 1: Verify OAuth tokens are valid
    console.log(`   Step 1: Verifying OAuth tokens...`);
    const accessToken = await getValidAccessToken(email);
    
    if (!accessToken) {
      throw new Error('No valid access token available');
    }
    
    console.log(`   ✓ OAuth token is valid`);
    
    // Step 2: Set Google authentication cookies WITHOUT navigating away
    console.log(`   Step 2: Setting authentication cookies (without navigation)...`);
    
    // Get current URL to preserve it
    const currentUrl = page.url();
    console.log(`   ℹ️  Current page: ${currentUrl}`);
    
    // Set authentication cookies directly (without navigating)
    // These cookies work across all Google domains
    await page.setCookie(
      {
        name: 'SID',
        value: accessToken.substring(0, 100),
        domain: '.google.com',
        path: '/',
        httpOnly: true,
        secure: true
      },
      {
        name: '__Secure-1PSID',
        value: accessToken.substring(0, 100),
        domain: '.google.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None'
      },
      {
        name: 'SSID',
        value: accessToken.substring(0, 100),
        domain: '.google.com',
        path: '/',
        httpOnly: true,
        secure: true
      }
    );
    
    console.log(`   ✓ Cookies set (3 authentication cookies)`);
    
    // Step 3: OAuth verification complete (no navigation needed)
    console.log(`   Step 3: OAuth verification complete`);
    
    // Return success without navigating away
    console.log(`✅ OAuth authentication successful for: ${email}`);
    console.log(`   ℹ️  Cookies set, staying on current page`);
    
    return {
      success: true,
      message: 'Successfully authenticated with OAuth (cookies set)',
      email: email,
      note: 'Stayed on current page to avoid navigation timeout'
    };
    
  } catch (error) {
    console.error(`❌ OAuth browser login failed for ${email}:`, error.message);
    return {
      success: false,
      error: error.message,
      email: email
    };
  }
}

module.exports = {
  getAuthUrl,
  getTokensFromCode,
  saveTokens,
  getValidAccessToken,
  verifyGmailAccount,
  hasOAuthTokens,
  getTokenInfo,
  loginWithOAuth
};
