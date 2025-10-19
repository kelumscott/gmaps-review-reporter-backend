/**
 * Test Supabase Connection
 * 
 * This script tests the connection to Supabase and verifies that
 * all required tables exist.
 * 
 * Usage: node test-connection.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function testConnection() {
  console.log('🔍 Testing Supabase Connection...\n');

  // Check environment variables
  console.log('📝 Environment Configuration:');
  console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL || '❌ NOT SET'}`);
  console.log(`   SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? '✅ SET' : '❌ NOT SET'}\n`);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('❌ Error: Environment variables not set!');
    console.log('\n💡 Make sure you have:');
    console.log('   1. Created a .env file');
    console.log('   2. Added SUPABASE_URL and SUPABASE_ANON_KEY\n');
    process.exit(1);
  }

  const tables = [
    'gmail_accounts',
    'reviews',
    'proxy_config',
    'automation_logs'
  ];

  console.log('🗄️  Testing Database Tables:\n');

  let allTablesExist = true;

  for (const table of tables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('count')
        .limit(0);

      if (error) {
        if (error.code === '42P01') {
          console.log(`   ❌ ${table} - Table does not exist`);
          allTablesExist = false;
        } else {
          console.log(`   ⚠️  ${table} - Error: ${error.message}`);
          allTablesExist = false;
        }
      } else {
        // Get row count
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        
        console.log(`   ✅ ${table} - OK (${count || 0} rows)`);
      }
    } catch (err) {
      console.log(`   ❌ ${table} - Unexpected error: ${err.message}`);
      allTablesExist = false;
    }
  }

  console.log('');

  if (allTablesExist) {
    console.log('✅ All tables exist! Database is ready.\n');
    
    // Show some statistics
    console.log('📊 Current Data:');
    
    try {
      const { data: accounts } = await supabase
        .from('gmail_accounts')
        .select('status');
      
      if (accounts) {
        const activeAccounts = accounts.filter(a => a.status === 'active').length;
        console.log(`   Gmail Accounts: ${accounts.length} total, ${activeAccounts} active`);
      }

      const { data: reviews } = await supabase
        .from('reviews')
        .select('status');
      
      if (reviews) {
        const pending = reviews.filter(r => r.status === 'pending').length;
        const inProgress = reviews.filter(r => r.status === 'in_progress').length;
        const completed = reviews.filter(r => r.status === 'completed').length;
        const failed = reviews.filter(r => r.status === 'failed').length;
        
        console.log(`   Reviews: ${reviews.length} total`);
        console.log(`      - Pending: ${pending}`);
        console.log(`      - In Progress: ${inProgress}`);
        console.log(`      - Completed: ${completed}`);
        console.log(`      - Failed: ${failed}`);
      }

      const { data: proxies } = await supabase
        .from('proxy_config')
        .select('is_active, provider, protocol, proxy_address, port');
      
      if (proxies) {
        const activeProxies = proxies.filter(p => p.is_active).length;
        console.log(`   Proxy Configs: ${proxies.length} total, ${activeProxies} active`);
        if (activeProxies > 0) {
          const activeProxy = proxies.find(p => p.is_active);
          console.log(`      - Provider: ${activeProxy.provider}`);
          console.log(`      - Endpoint: ${activeProxy.protocol}://${activeProxy.proxy_address}:${activeProxy.port}`);
        }
      }

      const { data: logs } = await supabase
        .from('automation_logs')
        .select('status');
      
      if (logs) {
        console.log(`   Automation Logs: ${logs.length} entries`);
      }
    } catch (err) {
      console.log('   (Could not fetch statistics)');
    }

    console.log('\n🚀 Ready to start automation service!');
    console.log('   Run: npm start\n');

  } else {
    console.log('❌ Some tables are missing!\n');
    console.log('💡 Next steps:');
    console.log('   1. Go to Supabase Dashboard');
    console.log('   2. Open SQL Editor');
    console.log('   3. Run the SQL script from the dashboard');
    console.log('   4. Run this test again\n');
    process.exit(1);
  }
}

testConnection().catch(error => {
  console.error('\n❌ Fatal Error:', error.message);
  console.log('\n💡 Possible issues:');
  console.log('   - Check your internet connection');
  console.log('   - Verify your Supabase credentials');
  console.log('   - Make sure .env file exists\n');
  process.exit(1);
});
