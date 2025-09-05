// api/check-username.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  const USERNAME_TO_CHECK = 'zubin';
  const SECRET_KEY = process.env.SECRET_KEY || 'your-secret-key-here';
  
  const { key, sendAlert, debug } = req.query;
  
  // Check authorization
  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // Try multiple methods to check availability
    const result = await checkUsernameWithFallbacks(USERNAME_TO_CHECK);
    
    // Only send SMS if we're confident the username is actually available
    // (not just blocked by 403)
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
  
  // Method 1: Direct check (will likely get 403)
  try {
    const directResult = await checkDirectly(username);
    debugInfo.directCheck = directResult;
    
    // If we get 403 OR a suspicious generic page size, we can't trust the result
    // 248732 is the size of X's generic/blocked page
    if (directResult.statusCode === 403 || directResult.size === 248732) {
      debugInfo.blocked = true;
      debugInfo.blockReason = directResult.size === 248732 ? 'Generic page detected' : '403 Forbidden';
      
      // Method 2: Try using a proxy service (free tier)
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
      
      // Method 3: Check via alternative endpoint
      const altResult = await checkViaAlternative(username);
      debugInfo.altCheck = altResult;
      
      if (altResult.success) {
        return {
          available: altResult.available,
          confidence: 'medium',
          message: altResult.available ? 'Username appears to be available' : 'Username appears to be taken',
          debug: debugInfo
        };
      }
      
      // If all methods fail, return blocked status
      return {
        available: false,
        confidence: 'low',
        message: '⚠️ Cannot verify - X.com is blocking checks from Vercel. Try checking manually or use a different monitoring method.',
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
    
    if (directResult.statusCode === 200) {
      return {
        available: false,
        confidence: 'high',
        message: 'Username is taken',
        debug: debugInfo
      };
    }
    
  } catch (error) {
    debugInfo.error = error.message;
  }
  
  return {
    available: false,
    confidence: 'low',
    message: 'Unable to check username status',
    debug: debugInfo
  };
}

async function checkDirectly(username) {
  try {
    const response = await fetch(`https://x.com/${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    
    // Get first 1000 chars to see what page we're getting
    const preview = html.substring(0, 1000);
    
    return {
      statusCode: response.status,
      size: html.length,
      hasProfile: html.toLowerCase().includes(`"${username.toLowerCase()}"`),
      preview: preview,
      title: html.match(/<title>(.*?)<\/title>/)?.[1] || 'No title found'
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function checkViaProxy(username) {
  // Using AllOrigins as a free CORS proxy
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://x.com/${username}`)}`;
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      return { success: false, error: 'Proxy request failed' };
    }
    
    const data = await response.json();
    const content = data.contents.toLowerCase();
    
    // Check if the profile exists
    if (content.includes(`@${username.toLowerCase()}`) && 
        (content.includes('followers') || content.includes('following'))) {
      return { success: true, available: false };
    }
    
    if (content.includes("this account doesn't exist") || 
        content.includes("this page doesn't exist")) {
      return { success: true, available: true };
    }
    
    if (content.includes('suspended')) {
      return { success: true, available: false };
    }
    
    // Check status code from proxy
    if (data.status && data.status.http_code === 404) {
      return { success: true, available: true };
    }
    
    return { success: false, error: 'Could not determine status' };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function checkViaAlternative(username) {
  // Try checking via X's API endpoints (public data)
  try {
    // X's public API endpoint for user info (might also be blocked)
    const response = await fetch(`https://x.com/i/api/graphql/G3KGOASz96M-Qu0nwmGXNg/UserByScreenName?variables=${encodeURIComponent(JSON.stringify({screen_name: username}))}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.status === 404) {
      return { success: true, available: true };
    }
    
    if (response.status === 200) {
      return { success: true, available: false };
    }
    
    return { success: false, statusCode: response.status };
    
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
