// api/check-username.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  const USERNAME_TO_CHECK = 'zubin';
  const SECRET_KEY = process.env.SECRET_KEY || 'your-secret-key-here';
  
  const { key, sendAlert, debug } = req.query;
  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // Add debug mode to see what's happening
    const checkResult = await checkUsernameAvailability(USERNAME_TO_CHECK, debug === 'true');
    
    if (sendAlert === 'true' && checkResult.available) {
      await sendSMS(`🚨 @${USERNAME_TO_CHECK} is NOW AVAILABLE on X! Claim it at x.com/${USERNAME_TO_CHECK}`);
    }
    
    res.status(200).json({
      username: USERNAME_TO_CHECK,
      available: checkResult.available,
      timestamp: new Date().toISOString(),
      message: checkResult.available ? 'Username is available!' : 'Username is taken or suspended',
      debug: debug === 'true' ? checkResult.debug : undefined
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to check username',
      details: error.message 
    });
  }
}

async function checkUsernameAvailability(username, includeDebug = false) {
  const debugInfo = {};
  
  try {
    // Try to fetch the X profile page
    const url = `https://x.com/${username}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      redirect: 'follow'
    });
    
    debugInfo.statusCode = response.status;
    debugInfo.url = response.url;
    
    // Get the response text
    const text = await response.text();
    debugInfo.responseLength = text.length;
    debugInfo.firstChars = text.substring(0, 500);
    
    // Check various indicators of availability
    const textLower = text.toLowerCase();
    
    // Indicators that the account EXISTS (is taken)
    const accountExistsIndicators = [
      '"screen_name":"' + username.toLowerCase() + '"',
      '@' + username.toLowerCase(),
      'property="og:title"',
      'property="og:description"',
      '"profile_image_url":',
      '"followers_count":',
      'data-testid="UserName"'
    ];
    
    const accountExists = accountExistsIndicators.some(indicator => 
      textLower.includes(indicator.toLowerCase())
    );
    
    if (accountExists) {
      debugInfo.reason = 'Found account indicators in page';
      debugInfo.detectedPattern = accountExistsIndicators.find(i => textLower.includes(i.toLowerCase()));
      return {
        available: false,
        debug: includeDebug ? debugInfo : undefined
      };
    }
    
    // Indicators that the account is SUSPENDED
    const suspendedIndicators = [
      'account has been suspended',
      'account suspended',
      'suspended account'
    ];
    
    const isSuspended = suspendedIndicators.some(indicator => 
      textLower.includes(indicator)
    );
    
    if (isSuspended) {
      debugInfo.reason = 'Account is suspended';
      return {
        available: false, // Suspended accounts aren't immediately available
        debug: includeDebug ? debugInfo : undefined
      };
    }
    
    // Indicators the page doesn't exist or account is available
    const notExistsIndicators = [
      'this account doesn't exist',
      'this account does not exist',
      'page doesn't exist',
      'page does not exist',
      'something went wrong',
      'this page is not available'
    ];
    
    const doesNotExist = notExistsIndicators.some(indicator => 
      textLower.includes(indicator)
    );
    
    if (doesNotExist) {
      debugInfo.reason = 'Found "does not exist" indicator';
      return {
        available: true,
        debug: includeDebug ? debugInfo : undefined
      };
    }
    
    // Check for 404 status
    if (response.status === 404) {
      debugInfo.reason = '404 status code';
      return {
        available: true,
        debug: includeDebug ? debugInfo : undefined
      };
    }
    
    // If we find no clear indicators, check page size
    // X profile pages are typically large (>50KB), error pages are small
    if (text.length < 20000) {
      debugInfo.reason = 'Small page size suggests error/not found';
      return {
        available: true,
        debug: includeDebug ? debugInfo : undefined
      };
    }
    
    // Default: if we got a normal response with content, account likely exists
    debugInfo.reason = 'Default: appears to be a profile page';
    return {
      available: false,
      debug: includeDebug ? debugInfo : undefined
    };
    
  } catch (error) {
    console.error('Error checking username:', error);
    debugInfo.error = error.message;
    return {
      available: false, // Be conservative on errors
      debug: includeDebug ? debugInfo : undefined
    };
  }
}

async function sendSMS(message) {
  if (process.env.TWILIO_ACCOUNT_SID) {
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
      throw new Error(`Twilio error: ${response.statusText}`);
    }
    return await response.json();
  }
  
  else if (process.env.YOUR_PHONE_NUMBER) {
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: process.env.YOUR_PHONE_NUMBER,
        message: message,
        key: process.env.TEXTBELT_KEY || 'textbelt'
      })
    });
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(`TextBelt error: ${result.error}`);
    }
    return result;
  }
  
  console.log('SMS not configured, skipping notification');
  return null;
}
