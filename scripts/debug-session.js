#!/usr/bin/env node

// const puppeteer = require('puppeteer');

async function debugSessionFlow() {
  console.log('🔍 Starting browser-based session debug...');
  console.log('═'.repeat(50));
  
  let browser;
  try {
    // Launch browser
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Enable request logging
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`🌐 REQUEST: ${request.method()} ${request.url()}`);
      }
    });
    
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        console.log(`📡 RESPONSE: ${response.status()} ${response.url()}`);
      }
    });
    
    // Enable console logging from browser
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`❌ BROWSER ERROR: ${msg.text()}`);
      } else if (msg.text().includes('Search error') || msg.text().includes('Failed')) {
        console.log(`⚠️ BROWSER: ${msg.text()}`);
      }
    });
    
    console.log('🌍 Navigating to login page...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    
    console.log('🔐 Attempting login...');
    
    // Fill login form
    await page.type('input[type="email"]', 'admin@example.com');
    await page.type('input[type="password"]', 'admin123');
    
    // Submit form and wait for navigation
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);
    
    console.log('✅ Login completed, checking current URL...');
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    
    if (currentUrl.includes('/dashboard')) {
      console.log('🎯 Successfully redirected to dashboard');
      
      // Wait a bit for React to load and make API calls
      console.log('⏳ Waiting for dashboard to load...');
      await page.waitForTimeout(3000);
      
      // Check if emails are displayed
      console.log('🔍 Checking for email content...');
      
      const emailElements = await page.$$eval('.border.rounded-lg.p-4', elements => {
        return elements.length;
      });
      
      console.log(`📧 Found ${emailElements} email elements in DOM`);
      
      // Check for loading state
      const isLoading = await page.$eval('.text-center', el => el.textContent?.includes('Loading'));
      if (isLoading) {
        console.log('⏳ Dashboard is still loading...');
      }
      
      // Check for error messages
      const hasErrors = await page.evaluate(() => {
        const toast = document.querySelector('[data-sonner-toaster]');
        return toast ? toast.textContent : null;
      });
      
      if (hasErrors) {
        console.log(`⚠️ Toast messages: ${hasErrors}`);
      }
      
      // Get console errors
      const logs = await page.evaluate(() => {
        return window.console.error.toString();
      });
      
      console.log('\n📊 Session Debug Summary:');
      console.log(`✅ Login: Successful`);
      console.log(`✅ Redirect: ${currentUrl}`);
      console.log(`📧 Email Elements: ${emailElements}`);
      console.log(`⚠️ Loading State: ${isLoading ? 'Still Loading' : 'Completed'}`);
      
    } else {
      console.log('❌ Login failed - not redirected to dashboard');
      console.log(`📍 Stuck on: ${currentUrl}`);
    }
    
  } catch (error) {
    console.error('💥 Browser test failed:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// For now, let's do a simpler test without puppeteer
async function simpleCurlTest() {
  console.log('🧪 Simple cURL-based session test...');
  console.log('═'.repeat(50));
  
  const { spawn } = require('child_process');
  
  // Test 1: Try to access dashboard directly
  console.log('🌍 Testing dashboard access...');
  
  return new Promise((resolve) => {
    const curl = spawn('curl', ['-s', 'http://localhost:3000/dashboard', '-o', '/dev/null', '-w', '%{http_code}']);
    
    let output = '';
    curl.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    curl.on('close', (code) => {
      console.log(`📡 Dashboard HTTP Status: ${output}`);
      
      if (output === '200') {
        console.log('✅ Dashboard is accessible');
      } else {
        console.log('❌ Dashboard access issue');
      }
      
      resolve();
    });
  });
}

// Only run if this script is executed directly
if (require.main === module) {
  // Check if puppeteer is available
  try {
    require.resolve('puppeteer');
    debugSessionFlow()
      .then(() => {
        console.log('\n✅ Browser debug completed!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n💥 Browser debug failed:', error);
        process.exit(1);
      });
  } catch (e) {
    console.log('📝 Puppeteer not available, using simple curl test...');
    simpleCurlTest()
      .then(() => {
        console.log('\n✅ Simple test completed!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n💥 Simple test failed:', error);
        process.exit(1);
      });
  }
}

module.exports = { debugSessionFlow, simpleCurlTest }; 