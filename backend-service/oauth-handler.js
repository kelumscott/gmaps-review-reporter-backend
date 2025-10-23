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
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Get refresh token for long-term access
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid'
    ],
    state: email, // Pass email to remember which account during callback
    prompt: 'consent' // Force consent screen to ensure we get refresh token
  });

  console.log(`🔐 Generated OAuth URL for: ${email}`);
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

module.exports = {
  getAuthUrl,
  getTokensFromCode,
  saveTokens,
  getValidAccessToken,
  verifyGmailAccount,
  hasOAuthTokens
};
