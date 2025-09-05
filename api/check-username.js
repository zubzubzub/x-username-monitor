// api/check-username.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  const USERNAME_TO_CHECK = 'zubinmowlavizubinmowlavi';  // Test with non-existent username
  const SECRET_KEY = process.env.SECRET_KEY || 'your-secret-key-here';
  // Force redeploy - v2
  const { key, sendAlert, debug } = req.query;
  
  // Check authorization
  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // Try multiple methods to check availability
    const result = await checkUsernameWithFallbacks(USERNAME_TO_CHECK);
    
    // Only send SMS if we're confident the username is actually available
    if (sendAlert === 'true' && result.available === true && result.confidence === 'high') {
      try {
        await sendSMS(`🚨 @${USERNAME_TO_CHECK} is NOW AVAILABLE on X! Claim it at x.com/${USERNAME_TO_CHECK}`);
      } catch (smsError) {
        console.error('SMS failed:', smsError);
      }
    }
    
    // Return response
    const response = {
      username: USERNAME_TO_CHECK,
      available: result.available,
      confidence: result.confidence,
      timestamp: new Date().toISOString(),
      message: result.message
    };
    
    // Add debug info if requested
    if (debug === 'true') {
      response.debug = result.debug;
    }
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Error in handler:', error);
    return res.status(500).json({ 
      error: 'Failed to check username',
      details: error.message || 'Unknown error'
    });
  }
}

async function checkUsernameWithFallbacks(username) {
  const debugInfo = {};
  
  try {
    // Method 1: Direct check (will likely get blocked)
    const directResult = await checkDirectly(username);
    debugInfo.directCheck = directResult;
    
    // Check if we got X's generic blocking page (around 248KB)
    const isGenericPage = directResult.size > 248000 && directResult.size < 250000 && !directResult.hasProfile;
    
    if (directResult.statusCode === 403 || isGenericPage) {
      debugInfo.blocked = true;
      debugInfo.blockReason = isGenericPage ? `Generic page detected (${directResult.size} bytes)` : '403 Forbidden';
      
      // Method 2: Try using a proxy service
      try {
        const proxyResult = await checkViaProxy(username);
        debugInfo.proxyCheck = proxyResult;
        
        if (proxyResult.success) {
          return {
            available: proxyResult.available,
            confidence: 'high',
            message: proxyResult.available ? 'Username is available!' : 'Username is taken',
            debug: debugInfo
          };
        }
      } catch (proxyError) {
        debugInfo.proxyError = proxyError.message;
      }
      
      // If proxy fails, we can't determine status
      return {
        available: false,
        confidence: 'low',
        message: '⚠️ Cannot verify - X.com is blocking checks from Vercel',
        debug: debugInfo
      };
    }
    
    // If direct check worked (rare from Vercel)
    if (directResult.statusCode === 404) {
      return {
        available: true,
        confidence: 'high',
        message: 'Username is available!',
        debug: debugInfo
      };
    }
    
    if (directResult.statusCode === 200 && directResult.hasProfile) {
      return {
        available: false,
        confidence: 'high',
        message: 'Username is taken',
        debug: debugInfo
      };
    }
    
    // Default case
    return {
      available: false,
      confidence: 'low',
      message: 'Unable to determine status',
      debug: debugInfo
    };
    
  } catch (error) {
    debugInfo.error = error.message;
    return {
      available: false,
      confidence: 'low',
      message: 'Error checking username',
      debug: debugInfo
    };
  }
}

async function checkDirectly(username) {
  try {
    const response = await fetch(`https://x.com/${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    const preview = html.substring(0, 1000);
    
    return {
      statusCode: response.status,
      size: html.length,
      hasProfile: html.toLowerCase().includes(`@${username.toLowerCase()}`),
      preview: preview,
      title: html.match(/<title>(.*?)<\/title>/)?.[1] || 'No title found'
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function checkViaProxy(username) {
  try {
    // Using AllOrigins as a free CORS proxy
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://x.com/${username}`)}`;
    
    const response = await fetch(proxyUrl, {
      timeout: 10000  // 10 second timeout
    });
    
    if (!response.ok) {
      return { success: false, error: 'Proxy request failed' };
    }
    
    const data = await response.json();
    const content = (data.contents || '').toLowerCase();
    
    // Check if account doesn't exist
    if (content.includes("this account doesn't exist") || 
        content.includes("this page doesn't exist")) {
      return { success: true, available: true };
    }
    
    // Check if the profile exists
    if (content.includes(`@${username.toLowerCase()}`) && 
        (content.includes('followers') || content.includes('following'))) {
      return { success: true, available: false };
    }
    
    // Check if suspended
    if (content.includes('suspended')) {
      return { success: true, available: false };
    }
    
    // Check status code from proxy
    if (data.status && data.status.http_code === 404) {
      return { success: true, available: true };
    }
    
    return { 
      success: false, 
      error: 'Could not determine status',
      contentLength: content.length 
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function sendSMS(message) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.YOUR_PHONE_NUMBER) {
    console.log('SMS not configured');
    return null;
  }
  
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_FROM;
    const toPhone = process.env.YOUR_PHONE_NUMBER;
    
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: toPhone,
          From: fromPhone,
          Body: message
        })
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio error: ${error}`);
    }
    
    return await response.json();
    
  } catch (error) {
    console.error('SMS error:', error);
    throw error;
  }
}
