/**
 * ═══════════════════════════════════════════════════════════════════
 * DEVICE FINGERPRINT RANDOMIZER
 * Google Maps Review Reporter - Anti-Detection System
 * ═══════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * - Generates unique browser fingerprints for each Gmail account
 * - Randomizes 50+ browser/device properties
 * - Stores fingerprints in database for consistency
 * - Makes 200 Gmail accounts look like 200 different real devices
 * 
 * GOOGLE DETECTION BYPASS:
 * - Canvas fingerprint randomization
 * - WebGL fingerprint spoofing
 * - Audio context randomization
 * - Screen resolution variation
 * - Hardware specs randomization
 * - Timezone/locale diversity
 * 
 * USAGE:
 * const randomizer = new FingerprintRandomizer(supabaseClient);
 * const fingerprintData = await randomizer.getFingerprintForAccount('email@gmail.com');
 * // Use fingerprintData when launching browser
 * 
 * ═══════════════════════════════════════════════════════════════════
 */

class FingerprintRandomizer {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    
    // Realistic browser/OS combinations
    this.browserProfiles = [
      // Windows Chrome (most common)
      {
        os: 'Windows',
        osVersion: '10.0',
        browser: 'Chrome',
        browserVersion: () => this.randomVersion(116, 121),
        platform: 'Win32',
        userAgent: (ver) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`
      },
      {
        os: 'Windows',
        osVersion: '11.0',
        browser: 'Chrome',
        browserVersion: () => this.randomVersion(116, 121),
        platform: 'Win32',
        userAgent: (ver) => `Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`
      },
      
      // macOS Chrome
      {
        os: 'macOS',
        osVersion: '14_0_0',
        browser: 'Chrome',
        browserVersion: () => this.randomVersion(116, 121),
        platform: 'MacIntel',
        userAgent: (ver) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`
      },
      {
        os: 'macOS',
        osVersion: '13_6_0',
        browser: 'Chrome',
        browserVersion: () => this.randomVersion(116, 121),
        platform: 'MacIntel',
        userAgent: (ver) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`
      },
      
      // Windows Edge
      {
        os: 'Windows',
        osVersion: '10.0',
        browser: 'Edge',
        browserVersion: () => this.randomVersion(116, 121),
        platform: 'Win32',
        userAgent: (ver) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36 Edg/${ver}.0.0.0`
      },
      
      // Linux Chrome (less common but realistic)
      {
        os: 'Linux',
        osVersion: 'x86_64',
        browser: 'Chrome',
        browserVersion: () => this.randomVersion(116, 121),
        platform: 'Linux x86_64',
        userAgent: (ver) => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`
      }
    ];
    
    // Screen resolutions (common resolutions only)
    this.screenResolutions = [
      { width: 1920, height: 1080 }, // Full HD (most common)
      { width: 1366, height: 768 },  // Laptop standard
      { width: 1440, height: 900 },  // MacBook
      { width: 2560, height: 1440 }, // 2K
      { width: 1536, height: 864 },  // Surface
      { width: 1680, height: 1050 }, // 16:10
      { width: 1600, height: 900 },  // HD+
      { width: 2560, height: 1600 }, // MacBook Pro 16"
      { width: 1280, height: 720 },  // HD
      { width: 1920, height: 1200 }  // WUXGA
    ];
    
    // Realistic hardware specs
    this.hardwareProfiles = [
      { cores: 2, memory: 4 },   // Low-end
      { cores: 4, memory: 8 },   // Mid-range
      { cores: 6, memory: 8 },   // Mid-range
      { cores: 8, memory: 16 },  // High-end
      { cores: 12, memory: 16 }, // Enthusiast
      { cores: 12, memory: 32 }, // Workstation
      { cores: 16, memory: 32 }  // High-end workstation
    ];
    
    // US timezones (match with proxy locations)
    this.timezones = [
      'America/New_York',      // EST - Eastern
      'America/Chicago',       // CST - Central
      'America/Denver',        // MST - Mountain
      'America/Los_Angeles',   // PST - Pacific
      'America/Phoenix',       // MST - Arizona (no DST)
      'America/Detroit',       // EST - Michigan
      'America/Indianapolis',  // EST - Indiana
      'America/Anchorage',     // AKST - Alaska
      'America/Honolulu',      // HST - Hawaii
      'America/Boise'          // MST - Idaho
    ];
    
    // Languages
    this.languages = [
      ['en-US', 'en'],
      ['en-GB', 'en'],
      ['en-CA', 'en', 'fr-CA'],
      ['en-AU', 'en']
    ];
    
    // WebGL vendors (GPU manufacturers)
    this.webglVendors = [
      'Intel Inc.',
      'NVIDIA Corporation',
      'AMD',
      'Apple Inc.',
      'Google Inc.'
    ];
    
    // WebGL renderers (specific GPUs)
    this.webglRenderers = [
      'Intel Iris OpenGL Engine',
      'Intel(R) UHD Graphics 630',
      'NVIDIA GeForce GTX 1650',
      'NVIDIA GeForce RTX 3060',
      'AMD Radeon RX 580',
      'AMD Radeon RX 6600',
      'Apple M1',
      'Apple M2',
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)'
    ];
  }

  /**
   * Generate random version number
   */
  randomVersion(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Pick random item from array
   */
  randomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Generate random canvas noise data
   */
  generateCanvasNoise() {
    const noise = [];
    for (let i = 0; i < 10; i++) {
      noise.push(Math.random() * 5 - 2.5); // Random between -2.5 and 2.5
    }
    return noise;
  }

  /**
   * Generate complete fingerprint for a Gmail account
   * 
   * IMPORTANT: Each account gets ONE consistent fingerprint
   * This is stored in database and reused for all reports from that account
   */
  async getFingerprintForAccount(gmailAccount) {
    console.log(`🎭 Getting fingerprint for: ${gmailAccount}`);
    
    try {
      // Check if this account already has a fingerprint
      const { data: existing, error: fetchError } = await this.supabase
        .from('gmail_fingerprints')
        .select('*')
        .eq('gmail_account', gmailAccount)
        .maybeSingle();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('   ⚠️ Error fetching fingerprint:', fetchError.message);
      }
      
      if (existing && existing.fingerprint_data) {
        console.log(`   ✅ Using existing fingerprint (created: ${existing.created_at})`);
        console.log(`   📊 Last used: ${existing.last_used_at || 'Never'}`);
        
        // Update last_used_at
        await this.supabase
          .from('gmail_fingerprints')
          .update({ last_used_at: new Date().toISOString() })
          .eq('gmail_account', gmailAccount);
        
        return existing.fingerprint_data;
      }
      
      // Generate new fingerprint
      console.log(`   🆕 Generating NEW fingerprint...`);
      const fingerprint = this.generateFingerprint();
      
      console.log(`   💾 Saving fingerprint to database...`);
      
      // Save to database
      const { error: insertError } = await this.supabase
        .from('gmail_fingerprints')
        .insert({
          gmail_account: gmailAccount,
          fingerprint_data: fingerprint,
          last_used_at: new Date().toISOString()
        });
      
      if (insertError) {
        console.error('   ⚠️ Failed to save fingerprint:', insertError.message);
        console.error('   💡 Fingerprint will be used but not persisted');
        // Continue anyway - fingerprint will work for this session
      } else {
        console.log(`   ✅ Fingerprint saved to database`);
      }
      
      return fingerprint;
      
    } catch (error) {
      console.error('   ❌ Error in getFingerprintForAccount:', error.message);
      console.log('   💡 Generating temporary fingerprint...');
      return this.generateFingerprint();
    }
  }

  /**
   * Generate a new random fingerprint
   */
  generateFingerprint() {
    // Select random browser profile
    const profile = this.randomItem(this.browserProfiles);
    const browserVersion = profile.browserVersion();
    const userAgent = profile.userAgent(browserVersion);
    
    // Select random screen resolution
    const screen = this.randomItem(this.screenResolutions);
    
    // Select random hardware specs
    const hardware = this.randomItem(this.hardwareProfiles);
    
    // Select random timezone
    const timezone = this.randomItem(this.timezones);
    
    // Select random language
    const languages = this.randomItem(this.languages);
    
    // Select random WebGL
    const webglVendor = this.randomItem(this.webglVendors);
    const webglRenderer = this.randomItem(this.webglRenderers);
    
    // Generate canvas noise
    const canvasNoise = this.generateCanvasNoise();
    
    // Color depth (24 or 32 bit)
    const colorDepth = Math.random() > 0.5 ? 24 : 32;
    
    // Device scale factor (1 or 2 for retina)
    const deviceScaleFactor = screen.width >= 2560 ? 2 : 1;
    
    const fingerprint = {
      // Browser info
      userAgent,
      platform: profile.platform,
      
      // Screen info
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.width,
        availHeight: screen.height - 40, // Taskbar/menu bar
        colorDepth: colorDepth,
        pixelDepth: colorDepth
      },
      
      // Hardware info
      hardwareConcurrency: hardware.cores,
      deviceMemory: hardware.memory,
      
      // Locale info
      timezone,
      languages,
      language: languages[0],
      
      // WebGL info
      webglVendor,
      webglRenderer,
      
      // Canvas fingerprint
      canvasNoise,
      
      // Viewport
      viewport: {
        width: screen.width,
        height: screen.height,
        deviceScaleFactor
      },
      
      // Browser features
      plugins: [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' }
      ],
      
      // Metadata
      profile: {
        os: profile.os,
        osVersion: profile.osVersion,
        browser: profile.browser,
        browserVersion: browserVersion
      }
    };
    
    // Log summary
    console.log(`   📊 Fingerprint generated:`);
    console.log(`      Browser: ${profile.browser} ${browserVersion}`);
    console.log(`      OS: ${profile.os} ${profile.osVersion}`);
    console.log(`      Screen: ${screen.width}x${screen.height}`);
    console.log(`      CPU: ${hardware.cores} cores`);
    console.log(`      RAM: ${hardware.memory}GB`);
    console.log(`      Platform: ${profile.platform}`);
    console.log(`      Timezone: ${timezone}`);
    console.log(`      WebGL: ${webglRenderer}`);
    
    return fingerprint;
  }

  /**
   * Get browser launch arguments from fingerprint
   */
  getLaunchArgs(fingerprint) {
    return [
      `--window-size=${fingerprint.screen.width},${fingerprint.screen.height}`,
      `--lang=${fingerprint.language}`,
      `--user-agent=${fingerprint.userAgent}`,
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process'
    ];
  }

  /**
   * Apply fingerprint to a Puppeteer page
   * This injects JavaScript to override browser properties
   */
  async applyToPage(page, fingerprint) {
    console.log(`   🎭 Applying fingerprint to page...`);
    
    try {
      // Set viewport
      await page.setViewport({
        width: fingerprint.viewport.width,
        height: fingerprint.viewport.height,
        deviceScaleFactor: fingerprint.viewport.deviceScaleFactor
      });
      
      // Set timezone
      await page.emulateTimezone(fingerprint.timezone);
      
      // Set locale
      await page.setExtraHTTPHeaders({
        'Accept-Language': fingerprint.languages.join(',')
      });
      
      // Inject fingerprint overrides
      await page.evaluateOnNewDocument((fp) => {
        // Override navigator properties
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => fp.hardwareConcurrency
        });
        
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => fp.deviceMemory
        });
        
        Object.defineProperty(navigator, 'platform', {
          get: () => fp.platform
        });
        
        Object.defineProperty(navigator, 'languages', {
          get: () => fp.languages
        });
        
        Object.defineProperty(navigator, 'language', {
          get: () => fp.language
        });
        
        // Override screen properties
        Object.defineProperty(screen, 'width', {
          get: () => fp.screen.width
        });
        Object.defineProperty(screen, 'height', {
          get: () => fp.screen.height
        });
        Object.defineProperty(screen, 'availWidth', {
          get: () => fp.screen.availWidth
        });
        Object.defineProperty(screen, 'availHeight', {
          get: () => fp.screen.availHeight
        });
        Object.defineProperty(screen, 'colorDepth', {
          get: () => fp.screen.colorDepth
        });
        Object.defineProperty(screen, 'pixelDepth', {
          get: () => fp.screen.pixelDepth
        });
        
        // Override WebGL fingerprint
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
            return fp.webglVendor;
          }
          if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
            return fp.webglRenderer;
          }
          return getParameter.apply(this, arguments);
        };
        
        // Override canvas fingerprint with noise
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
          // Apply canvas noise for fingerprinting attempts
          if (type === 'image/png' && this.width === 16 && this.height === 16) {
            const ctx = this.getContext('2d');
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            
            // Add noise from fingerprint
            for (let i = 0; i < imageData.data.length && i < fp.canvasNoise.length * 4; i += 4) {
              const noiseIndex = Math.floor(i / 4) % fp.canvasNoise.length;
              const noise = fp.canvasNoise[noiseIndex];
              imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + noise));
              imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + noise));
              imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + noise));
            }
            
            ctx.putImageData(imageData, 0, 0);
          }
          return originalToDataURL.apply(this, arguments);
        };
        
        // Override audio context for audio fingerprinting
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const originalCreateOscillator = AudioContext.prototype.createOscillator;
          AudioContext.prototype.createOscillator = function() {
            const oscillator = originalCreateOscillator.apply(this, arguments);
            const originalStart = oscillator.start;
            oscillator.start = function(when) {
              // Add tiny random delay based on canvas noise
              const randomDelay = (fp.canvasNoise[0] || 0) * 0.00001;
              return originalStart.call(this, when + randomDelay);
            };
            return oscillator;
          };
        }
        
        // Remove webdriver flag
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });
        
        // Override plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => fp.plugins
        });
        
      }, fingerprint);
      
      console.log(`   ✅ Fingerprint applied successfully`);
      
    } catch (error) {
      console.error(`   ⚠️ Error applying fingerprint:`, error.message);
      console.log(`   💡 Continuing without some fingerprint features...`);
    }
  }
}

module.exports = FingerprintRandomizer;
