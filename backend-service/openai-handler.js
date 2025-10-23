/**
 * OpenAI GPT-5 Handler - Review Analysis & Legal Draft Generation
 * 
 * This module handles:
 * - AI analysis of review content
 * - Violation detection with confidence scoring
 * - Legal draft generation (max 1000 characters)
 * - Cost tracking
 */

const OpenAI = require('openai');
const { RateLimiter } = require('limiter');

// Initialize OpenAI client
let openai = null;
let openaiModel = 'gpt-4o'; // Default model

// Rate limiter: 50 requests per minute (OpenAI tier 1 limit)
const rateLimiter = new RateLimiter({ tokensPerInterval: 50, interval: 'minute' });

/**
 * Initialize OpenAI client
 */
function initialize(apiKey, model = 'gpt-4o') {
  if (!apiKey) {
    console.warn('⚠️ OpenAI API key not set - AI features will be disabled');
    return false;
  }
  
  try {
    openai = new OpenAI({ apiKey });
    openaiModel = model;
    console.log(`🤖 OpenAI client initialized (model: ${openaiModel})`);
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize OpenAI:', error.message);
    return false;
  }
}

/**
 * Analyze review with GPT-5
 * @param {string} reviewText - Full review text
 * @param {object} reviewMetadata - {rating, reviewerName, reviewDate, hasResponse}
 * @param {string} requestedReason - User's requested report reason
 * @returns {Promise<object>} Analysis result
 */
async function analyzeReview(reviewText, reviewMetadata, requestedReason) {
  if (!openai) {
    throw new Error('OpenAI client not initialized');
  }
  
  console.log(`🤖 Analyzing review with ${openaiModel}...`);
  console.log(`   Requested reason: ${requestedReason}`);
  console.log(`   Review length: ${reviewText.length} chars`);
  
  // Wait for rate limit
  await rateLimiter.removeTokens(1);
  
  const startTime = Date.now();
  
  try {
    const response = await openai.chat.completions.create({
      model: openaiModel,
      messages: [
        {
          role: 'system',
          content: getSystemPrompt()
        },
        {
          role: 'user',
          content: getUserPrompt(reviewText, reviewMetadata, requestedReason)
        }
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });
    
    const duration = Date.now() - startTime;
    const analysis = JSON.parse(response.choices[0].message.content);
    
    console.log('✅ OpenAI Analysis Complete:');
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Violates Policy: ${analysis.violates_policy ? '✅ YES' : '❌ NO'}`);
    console.log(`   Category: ${analysis.violation_category}`);
    console.log(`   Confidence: ${analysis.confidence}%`);
    console.log(`   Recommended Action: ${analysis.recommended_action}`);
    
    // Validate legal draft length
    if (analysis.legal_draft && analysis.legal_draft.length > 1000) {
      console.warn(`⚠️ Legal draft too long (${analysis.legal_draft.length} chars), truncating to 1000`);
      analysis.legal_draft = analysis.legal_draft.substring(0, 997) + '...';
    }
    
    // Calculate cost
    const cost = calculateCost(response.usage);
    console.log(`💰 Cost: $${cost.toFixed(4)}`);
    
    return {
      analysis,
      usage: response.usage,
      cost,
      duration,
      model: openaiModel
    };
    
  } catch (error) {
    console.error('❌ OpenAI API Error:', error.message);
    
    if (error.code === 'rate_limit_exceeded') {
      throw new Error('OpenAI rate limit exceeded. Please try again in a moment.');
    }
    
    if (error.code === 'insufficient_quota') {
      throw new Error('OpenAI API quota exceeded. Please check your billing.');
    }
    
    throw error;
  }
}

/**
 * Generate legal draft only (without full analysis)
 * @param {string} reviewText - Full review text
 * @param {object} reviewMetadata - Review metadata
 * @param {string} violationType - Type of violation
 * @param {string} existingDraft - Existing draft if available (to skip OpenAI call)
 * @returns {Promise<string>} Legal draft (max 1000 chars)
 */
async function generateLegalDraft(reviewText, reviewMetadata, violationType, existingDraft = null) {
  // IMPORTANT: Reuse existing draft if available (save cost & time)
  if (existingDraft && existingDraft.length > 0) {
    console.log(`♻️ Reusing existing legal draft (${existingDraft.length} chars)`);
    console.log(`💰 Cost saved: $0.01 (no OpenAI API call needed)`);
    return existingDraft;
  }
  
  if (!openai) {
    throw new Error('OpenAI client not initialized');
  }
  
  console.log(`⚖️ Generating NEW legal draft for: ${violationType}`);
  
  await rateLimiter.removeTokens(1);
  
  try {
    const response = await openai.chat.completions.create({
      model: openaiModel,
      messages: [
        {
          role: 'system',
          content: 'You are a legal expert writing formal removal requests for Google. Be concise, professional, and factual. Maximum 1000 characters.'
        },
        {
          role: 'user',
          content: `Write a formal legal explanation for requesting removal of this review from Google Maps.

**Review Text:**
${reviewText}

**Violation Type:** ${violationType}

**Requirements:**
- Maximum 1000 characters
- Professional legal tone
- State facts clearly
- Explain why it violates Google's policies
- Request removal

Provide ONLY the legal draft text, no preamble.`
        }
      ],
      temperature: 0.3,
      max_tokens: 400
    });
    
    let draft = response.choices[0].message.content.trim();
    
    // Truncate if needed
    if (draft.length > 1000) {
      draft = draft.substring(0, 997) + '...';
    }
    
    console.log(`✅ Legal draft generated (${draft.length} chars)`);
    
    return draft;
    
  } catch (error) {
    console.error('❌ Failed to generate legal draft:', error.message);
    
    // Return fallback template
    return getFallbackLegalDraft(violationType, reviewText);
  }
}

/**
 * Get system prompt for AI analysis
 */
function getSystemPrompt() {
  return `You are a legal expert analyzing Google Maps reviews for policy violations.

Your task:
1. Determine if the review violates Google's review policies
2. Identify the specific violation category
3. Generate a legal explanation for removal request

Google's review policy violations include:
- **conflict_of_interest**: Competitor reviews, fake reviews from business rivals
- **fake_review**: Fraudulent reviews, reviews for wrong business, non-customer reviews
- **spam**: Irrelevant content, promotional content, repetitive reviews
- **harassment**: Bullying, threats, hate speech, personal attacks
- **personal_information**: Disclosure of private information (addresses, phone numbers, etc.)
- **off_topic**: Content unrelated to the business or customer experience
- **profanity**: Inappropriate language, vulgar content

Respond in JSON format:
{
  "violates_policy": true/false,
  "violation_category": "conflict_of_interest" | "fake_review" | "spam" | "harassment" | "personal_information" | "off_topic" | "profanity",
  "confidence": 0-100,
  "explanation": "Brief explanation (max 200 chars)",
  "legal_draft": "Formal legal explanation for removal request (max 1000 chars)",
  "recommended_action": "standard_report" | "legal_report" | "no_action",
  "evidence": ["Key phrase 1", "Key phrase 2"]
}

Be objective and accurate. Only flag genuine violations.`;
}

/**
 * Get user prompt with review data
 */
function getUserPrompt(reviewText, reviewMetadata, requestedReason) {
  return `Analyze this review:

**Review Text:**
${reviewText}

**Metadata:**
- Rating: ${reviewMetadata.rating || 'Unknown'} stars
- Reviewer: ${reviewMetadata.reviewerName || 'Unknown'}
- Date: ${reviewMetadata.reviewDate || 'Unknown'}
- Business Response: ${reviewMetadata.hasResponse ? 'Yes' : 'No'}

**Requested Report Reason:** ${requestedReason}

Please analyze if this review genuinely violates the "${requestedReason}" policy or any other Google policy.`;
}

/**
 * Calculate cost based on token usage
 */
function calculateCost(usage) {
  const costs = {
    'gpt-4o': {
      input: 0.005 / 1000,
      output: 0.015 / 1000
    },
    'gpt-5': {
      input: 0.01 / 1000,
      output: 0.03 / 1000
    },
    'gpt-4o-mini': {
      input: 0.00015 / 1000,
      output: 0.0006 / 1000
    }
  };
  
  const modelCosts = costs[openaiModel] || costs['gpt-4o'];
  
  const inputCost = usage.prompt_tokens * modelCosts.input;
  const outputCost = usage.completion_tokens * modelCosts.output;
  
  return inputCost + outputCost;
}

/**
 * Fallback legal draft template (when AI fails)
 */
function getFallbackLegalDraft(violationType, reviewText) {
  const templates = {
    conflict_of_interest: `This review appears to violate Google's policy against conflict of interest. The review exhibits characteristics consistent with a competitor attempting to damage our business reputation. The content does not reflect a genuine customer experience and appears designed to mislead potential customers. We request removal under Google's policy prohibiting reviews from business competitors.`,
    
    fake_review: `This review appears to be fraudulent and does not represent a genuine customer experience. There is no record of this reviewer as a customer in our systems. The review violates Google's policy against fake reviews. We request immediate removal to maintain the integrity of our business listing.`,
    
    spam: `This review consists of spam or promotional content unrelated to our business. It violates Google's policy against spam and irrelevant content. The review does not provide any legitimate feedback about customer experience. We request removal under Google's spam policy.`,
    
    harassment: `This review contains harassing, threatening, or inappropriate language directed at our business or staff. It violates Google's policy against harassment and hate speech. The content goes beyond legitimate feedback and constitutes harassment. We request removal to protect our employees and business.`,
    
    personal_information: `This review discloses private personal information in violation of Google's privacy policies. The content includes sensitive information that should not be publicly shared. We request immediate removal to protect individual privacy.`,
    
    off_topic: `This review is completely off-topic and unrelated to our business or services. It violates Google's policy requiring reviews to be relevant to the business being reviewed. The content provides no value to potential customers. We request removal under Google's relevance policy.`,
    
    profanity: `This review contains profane, vulgar, or inappropriate language that violates Google's content policies. The language used is offensive and does not constitute legitimate business feedback. We request removal to maintain a professional environment.`
  };
  
  let draft = templates[violationType] || templates['fake_review'];
  
  // Truncate if needed
  if (draft.length > 1000) {
    draft = draft.substring(0, 997) + '...';
  }
  
  return draft;
}

/**
 * Validate OpenAI is initialized
 */
function isInitialized() {
  return openai !== null;
}

module.exports = {
  initialize,
  analyzeReview,
  generateLegalDraft,
  isInitialized
};
