/**
 * Legal Form Handler - Auto-Fill & Auto-Submit Google Legal Removal Forms
 * 
 * This module handles:
 * - Navigating to Google's legal removal form
 * - Auto-filling all form fields
 * - Handling reCAPTCHA with CapSolver API (cheaper & faster than 2Captcha)
 * - Auto-submitting the form
 * - Capturing confirmation IDs
 */

const axios = require('axios');

// CapSolver API configuration
let capsolverApiKey = null;

/**
 * Initialize CapSolver client
 */
function initializeCaptcha(apiKey) {
  if (!apiKey) {
    console.warn('⚠️ CapSolver API key not set - CAPTCHA auto-solve disabled');
    console.warn('⚠️ Legal forms with CAPTCHA will FAIL!');
    return false;
  }
  
  capsolverApiKey = apiKey;
  console.log('🤖 CapSolver initialized (60% cheaper & 3x faster than 2Captcha)');
  return true;
}

/**
 * Fill and submit legal removal form
 * @param {Page} page - Puppeteer page instance
 * @param {object} reviewData - Review information
 * @param {object} formSubmitter - Form submitter identity
 * @param {string} legalDraft - AI-generated legal explanation
 * @returns {Promise<object>} Submission result
 */
async function fillAndSubmitLegalForm(page, reviewData, formSubmitter, legalDraft) {
  console.log('\n📝 ===== LEGAL FORM AUTO-FILL & SUBMIT =====');
  console.log(`   Review: ${reviewData.review_url}`);
  console.log(`   Submitter: ${formSubmitter.full_name}`);
  console.log(`   Draft Length: ${legalDraft.length} chars`);
  
  try {
    // Navigate to legal removal form
    console.log('🔗 Navigating to legal removal form...');
    await page.goto('https://support.google.com/legal/contact/lr_legalother', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    console.log('✅ Legal form loaded');
    
    // Wait for form to be ready
    await page.waitForSelector('form', { timeout: 10000 });
    await page.waitForTimeout(2000); // Wait for dynamic content
    
    // ===== SECTION 1: Your Information =====
    console.log('\n📋 Section 1: Your Information');
    
    // 1. Country dropdown
    await fillCountryDropdown(page, formSubmitter.country_code);
    
    // 2. Full legal name
    await fillTextField(page, 'Full legal name', formSubmitter.full_name);
    
    // 3. Acting on behalf of: Myself (should be default, verify)
    await selectRadioOption(page, 'Acting on behalf', 'myself');
    
    // ===== SECTION 2: Allegedly Infringing Content =====
    console.log('\n📋 Section 2: Allegedly Infringing Content');
    
    // 4. SKIP "Is this submission related to something other than a review?" checkbox
    // (We intentionally leave this unchecked)
    
    // 5. Google product/service dropdown: Google Search
    await selectDropdown(page, 'Google product', 'Google Search');
    
    // 6. URL of allegedly infringing content
    await fillTextField(page, 'URL', reviewData.review_url);
    
    // ===== SECTION 3: Legal Issue =====
    console.log('\n📋 Section 3: Legal Issue');
    
    // 7. Legal explanation (AI-generated 1000 char draft)
    await fillTextarea(page, 'explanation', legalDraft);
    
    // ===== SECTION 4: Signature & Consent =====
    console.log('\n📋 Section 4: Signature & Consent');
    
    // 8. Signature (must match full name)
    await fillTextField(page, 'Signature', formSubmitter.full_name);
    
    // 9. Validate signature matches name
    await validateSignature(page, formSubmitter.full_name);
    
    // 10. Consent checkbox
    await checkCheckbox(page, 'consent');
    
    // ===== HANDLE CAPTCHA =====
    console.log('\n🔒 Handling reCAPTCHA...');
    const captchaResult = await handleRecaptcha(page);
    
    if (!captchaResult.success) {
      throw new Error('Failed to solve CAPTCHA');
    }
    
    // ===== SUBMIT FORM =====
    console.log('\n✅ Form filled completely - submitting...');
    await submitForm(page);
    
    // ===== CAPTURE CONFIRMATION =====
    console.log('\n🎯 Waiting for confirmation...');
    const confirmationId = await captureConfirmation(page);
    
    // Take screenshot of success
    const screenshotPath = `screenshots/legal-success-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Success screenshot: ${screenshotPath}`);
    
    console.log('\n🎉 ===== LEGAL FORM SUBMITTED SUCCESSFULLY =====');
    
    return {
      success: true,
      confirmationId,
      screenshotPath,
      captchaMethod: captchaResult.method,
      captchaSolveDuration: captchaResult.duration,
      captchaCost: captchaResult.cost,
      submittedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('\n❌ ===== LEGAL FORM SUBMISSION FAILED =====');
    console.error(`   Error: ${error.message}`);
    
    // Capture error screenshot
    try {
      const errorScreenshot = `screenshots/legal-error-${Date.now()}.png`;
      await page.screenshot({ path: errorScreenshot, fullPage: true });
      console.log(`📸 Error screenshot saved: ${errorScreenshot}`);
    } catch (screenshotError) {
      console.error('Failed to capture error screenshot:', screenshotError.message);
    }
    
    throw error;
  }
}

/**
 * Fill country dropdown
 */
async function fillCountryDropdown(page, countryCode) {
  console.log(`🌍 Selecting country: ${countryCode}`);
  
  const selectors = [
    'select[name*="country"]',
    'select[id*="country"]',
    'select[aria-label*="country"]',
    'div[role="listbox"][aria-label*="country"]'
  ];
  
  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const tagName = await element.evaluate(el => el.tagName);
        
        if (tagName === 'SELECT') {
          // Standard dropdown
          await page.select(selector, countryCode);
          console.log(`✅ Selected country from dropdown: ${countryCode}`);
          await page.waitForTimeout(500);
          return;
        } else {
          // Custom dropdown (Material UI, etc.)
          await element.click();
          await page.waitForTimeout(500);
          
          // Find option with country code
          const option = await page.$(`[data-value="${countryCode}"], [value="${countryCode}"]`);
          if (option) {
            await option.click();
            console.log(`✅ Selected country from custom dropdown: ${countryCode}`);
            await page.waitForTimeout(500);
            return;
          }
        }
      }
    } catch (error) {
      // Try next selector
      continue;
    }
  }
  
  console.warn('⚠️ Could not find country dropdown - may already be set or not required');
}

/**
 * Fill text field by label
 */
async function fillTextField(page, labelText, value) {
  console.log(`✍️ Filling "${labelText}": ${value}`);
  
  const selector = await findFieldByLabel(page, labelText);
  
  if (!selector) {
    throw new Error(`Could not find field: ${labelText}`);
  }
  
  // Clear existing value
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = '';
  }, selector);
  
  // Type slowly (appear human)
  await page.type(selector, value, { delay: 50 });
  console.log(`✅ Filled "${labelText}"`);
  await page.waitForTimeout(300);
}

/**
 * Fill textarea by label
 */
async function fillTextarea(page, labelText, value) {
  console.log(`✍️ Filling textarea "${labelText}": ${value.substring(0, 100)}...`);
  
  const selector = await findFieldByLabel(page, labelText, 'textarea');
  
  if (!selector) {
    throw new Error(`Could not find textarea: ${labelText}`);
  }
  
  // Clear existing value
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = '';
  }, selector);
  
  // Type legal explanation
  await page.type(selector, value, { delay: 30 }); // Slightly faster for long text
  console.log(`✅ Filled textarea (${value.length} characters)`);
  await page.waitForTimeout(500);
}

/**
 * Select dropdown option
 */
async function selectDropdown(page, labelText, value) {
  console.log(`🔽 Selecting "${labelText}": ${value}`);
  
  const selectors = [
    `select[name*="${labelText}" i]`,
    `select[id*="${labelText}" i]`,
    `select[aria-label*="${labelText}" i]`
  ];
  
  for (const selector of selectors) {
    try {
      const dropdown = await page.$(selector);
      if (dropdown) {
        await page.select(selector, value);
        console.log(`✅ Selected "${value}" from dropdown`);
        await page.waitForTimeout(500);
        return;
      }
    } catch (error) {
      continue;
    }
  }
  
  console.warn(`⚠️ Could not find dropdown: ${labelText}`);
}

/**
 * Select radio button option
 */
async function selectRadioOption(page, groupName, value) {
  console.log(`📻 Selecting radio option "${groupName}": ${value}`);
  
  const selectors = [
    `input[type="radio"][value*="${value}" i]`,
    `input[type="radio"][id*="${value}" i]`,
    `input[type="radio"][aria-label*="${value}" i]`
  ];
  
  for (const selector of selectors) {
    try {
      const radio = await page.$(selector);
      if (radio) {
        await radio.click();
        console.log(`✅ Selected radio: ${value}`);
        await page.waitForTimeout(300);
        return;
      }
    } catch (error) {
      continue;
    }
  }
  
  console.warn(`⚠️ Could not find radio option: ${value} (may already be default)`);
}

/**
 * Check checkbox
 */
async function checkCheckbox(page, labelText) {
  console.log(`☑️ Checking checkbox: ${labelText}`);
  
  const selectors = [
    `input[type="checkbox"][name*="${labelText}" i]`,
    `input[type="checkbox"][id*="${labelText}" i]`,
    `input[type="checkbox"][aria-label*="${labelText}" i]`
  ];
  
  for (const selector of selectors) {
    try {
      const checkbox = await page.$(selector);
      if (checkbox) {
        const isChecked = await checkbox.evaluate(el => el.checked);
        if (isChecked) {
          console.log(`✅ Checkbox already checked`);
          return;
        }
        
        await checkbox.click();
        console.log(`✅ Checked checkbox: ${labelText}`);
        await page.waitForTimeout(300);
        return;
      }
    } catch (error) {
      continue;
    }
  }
  
  // Try finding by label text
  const labelSelector = await page.evaluate((text) => {
    const labels = Array.from(document.querySelectorAll('label'));
    const matchingLabel = labels.find(l => 
      l.textContent.toLowerCase().includes(text.toLowerCase())
    );
    
    if (matchingLabel) {
      const checkbox = matchingLabel.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.click();
        return true;
      }
    }
    return false;
  }, labelText);
  
  if (labelSelector) {
    console.log(`✅ Checked checkbox via label: ${labelText}`);
    await page.waitForTimeout(300);
    return;
  }
  
  throw new Error(`Could not find checkbox: ${labelText}`);
}

/**
 * Validate signature matches full name
 */
async function validateSignature(page, expectedName) {
  console.log('✅ Validating signature matches full name...');
  
  const signatureSelector = await findFieldByLabel(page, 'Signature');
  const signatureValue = await page.$eval(signatureSelector, el => el.value);
  
  if (signatureValue.trim() !== expectedName.trim()) {
    throw new Error(`Signature mismatch! Expected "${expectedName}" but got "${signatureValue}"`);
  }
  
  console.log('✅ Signature validated');
}

/**
 * Handle reCAPTCHA (AUTO-SOLVE with CapSolver API)
 * 60% cheaper and 3x faster than 2Captcha
 */
async function handleRecaptcha(page) {
  console.log('🔍 Checking for reCAPTCHA...');
  
  // Check if reCAPTCHA exists
  const recaptchaFrame = await page.$('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
  
  if (!recaptchaFrame) {
    console.log('✅ No CAPTCHA detected');
    return { success: true, method: 'none', duration: 0, cost: 0 };
  }
  
  console.log('⚠️ reCAPTCHA detected!');
  
  if (!capsolverApiKey) {
    throw new Error('CapSolver not initialized - cannot solve CAPTCHA automatically! Set CAPSOLVER_API_KEY environment variable.');
  }
  
  console.log('🤖 Solving CAPTCHA with CapSolver API (fast & cheap)...');
  
  // Get site key
  const siteKey = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="recaptcha"]');
    if (!iframe) return null;
    
    const src = iframe.getAttribute('src');
    const match = src.match(/k=([^&]+)/);
    return match ? match[1] : null;
  });
  
  if (!siteKey) {
    throw new Error('Could not find reCAPTCHA site key');
  }
  
  console.log(`🔑 Site key: ${siteKey.substring(0, 20)}...`);
  
  try {
    const startTime = Date.now();
    
    // Create task with CapSolver
    const createTaskResponse = await axios.post('https://api.capsolver.com/createTask', {
      clientKey: capsolverApiKey,
      task: {
        type: 'ReCaptchaV2TaskProxyLess',
        websiteURL: page.url(),
        websiteKey: siteKey
      }
    });
    
    if (createTaskResponse.data.errorId !== 0) {
      throw new Error(`CapSolver error: ${createTaskResponse.data.errorDescription}`);
    }
    
    const taskId = createTaskResponse.data.taskId;
    console.log(`📋 Task created: ${taskId}`);
    
    // Poll for result
    let captchaToken = null;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds max
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const resultResponse = await axios.post('https://api.capsolver.com/getTaskResult', {
        clientKey: capsolverApiKey,
        taskId: taskId
      });
      
      if (resultResponse.data.status === 'ready') {
        captchaToken = resultResponse.data.solution.gRecaptchaResponse;
        break;
      }
      
      attempts++;
      console.log(`⏳ Waiting for CAPTCHA solution... (${attempts * 2}s)`);
    }
    
    if (!captchaToken) {
      throw new Error('CapSolver timeout - CAPTCHA not solved within 60 seconds');
    }
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`✅ CAPTCHA solved in ${duration} seconds`);
    console.log(`   Token: ${captchaToken.substring(0, 30)}...`);
    
    // Inject solution into page
    await page.evaluate((token) => {
      // Set g-recaptcha-response
      const responseEl = document.getElementById('g-recaptcha-response');
      if (responseEl) {
        responseEl.innerHTML = token;
      }
      
      // Trigger callback
      if (typeof ___grecaptcha_cfg !== 'undefined') {
        const clients = ___grecaptcha_cfg.clients;
        Object.keys(clients).forEach(key => {
          const client = clients[key];
          if (client && client.callback) {
            client.callback(token);
          }
        });
      }
      
      // Alternative: window.grecaptcha.execute()
      if (window.grecaptcha && window.grecaptcha.execute) {
        window.grecaptcha.execute();
      }
    }, captchaToken);
    
    console.log('✅ CAPTCHA token injected into page');
    
    // Wait for any post-CAPTCHA processing
    await page.waitForTimeout(2000);
    
    return { 
      success: true, 
      method: 'capsolver',
      duration,
      cost: 0.0008 // $0.0008 per captcha (60% cheaper than 2Captcha)
    };
    
  } catch (error) {
    console.error('❌ CapSolver failed:', error.message);
    throw new Error(`CAPTCHA solving failed: ${error.message}. Legal form CANNOT be submitted without solving CAPTCHA.`);
  }
}

/**
 * Submit the form
 */
async function submitForm(page) {
  console.log('🖱️ Clicking submit button...');
  
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button[aria-label*="Submit"]',
    'button.submit-button'
  ];
  
  for (const selector of submitSelectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        // Check if button is disabled
        const isDisabled = await button.evaluate(el => el.disabled);
        if (isDisabled) {
          console.warn(`⚠️ Submit button is disabled - checking for validation errors...`);
          continue;
        }
        
        await button.click();
        console.log('✅ Submit button clicked');
        await page.waitForTimeout(2000);
        return;
      }
    } catch (error) {
      continue;
    }
  }
  
  throw new Error('Could not find enabled submit button');
}

/**
 * Capture confirmation ID after successful submission
 */
async function captureConfirmation(page) {
  // Wait for navigation or success message
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
    // May not navigate, just show success message
  });
  
  // Look for confirmation message
  const confirmationSelectors = [
    'div[role="alert"]',
    '.confirmation-message',
    '[class*="success"]',
    '[class*="confirmation"]'
  ];
  
  for (const selector of confirmationSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const text = await element.evaluate(el => el.textContent);
        console.log(`📋 Confirmation: ${text}`);
        
        // Extract ID if present (format varies)
        const idMatch = text.match(/ID[:\s]+([A-Z0-9\-]+)/i);
        if (idMatch) {
          return idMatch[1];
        }
        
        return text.substring(0, 100); // Return first 100 chars as confirmation
      }
    } catch (error) {
      continue;
    }
  }
  
  // Fallback: return current URL as confirmation
  const currentUrl = page.url();
  console.log(`✅ Submission confirmed (URL: ${currentUrl})`);
  return currentUrl;
}

/**
 * Find input field by label text
 */
async function findFieldByLabel(page, labelText, tagName = 'input') {
  const selector = await page.evaluate((text, tag) => {
    // Try multiple strategies
    
    // 1. Find label with matching text
    const labels = Array.from(document.querySelectorAll('label'));
    const matchingLabel = labels.find(l => 
      l.textContent.toLowerCase().includes(text.toLowerCase())
    );
    
    if (matchingLabel) {
      // Check for 'for' attribute
      const forAttr = matchingLabel.getAttribute('for');
      if (forAttr) {
        const input = document.getElementById(forAttr);
        if (input) {
          return `#${forAttr}`;
        }
      }
      
      // Check for nested input
      const nestedInput = matchingLabel.querySelector(tag);
      if (nestedInput) {
        if (nestedInput.id) return `#${nestedInput.id}`;
        if (nestedInput.name) return `${tag}[name="${nestedInput.name}"]`;
      }
    }
    
    // 2. Find by aria-label
    const byAriaLabel = document.querySelector(`${tag}[aria-label*="${text}" i]`);
    if (byAriaLabel) {
      if (byAriaLabel.id) return `#${byAriaLabel.id}`;
      if (byAriaLabel.name) return `${tag}[name="${byAriaLabel.name}"]`;
    }
    
    // 3. Find by name attribute
    const byName = document.querySelector(`${tag}[name*="${text}" i]`);
    if (byName) {
      if (byName.id) return `#${byName.id}`;
      return `${tag}[name="${byName.name}"]`;
    }
    
    // 4. Find by placeholder
    const byPlaceholder = document.querySelector(`${tag}[placeholder*="${text}" i]`);
    if (byPlaceholder) {
      if (byPlaceholder.id) return `#${byPlaceholder.id}`;
      if (byPlaceholder.name) return `${tag}[name="${byPlaceholder.name}"]`;
    }
    
    return null;
  }, labelText, tagName);
  
  return selector;
}

module.exports = {
  initializeCaptcha,
  fillAndSubmitLegalForm
};
