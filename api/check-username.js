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
    // Check username availability
    const result = await checkUsernameAvailability(USERNAME_TO_CHECK);
    
    // Send SMS if requested and username is available
    if (sendAlert === 'true' && result.available === true) {
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
      timestamp: new Date().toISOString(),
      message: result.available ? 'Username is available!' : 'Username is taken or suspended'
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

async function checkUsernameAvailability(username) {
  const debugInfo = {};
  
  try {
    const url = `https://x.com/${username}`;
    debugInfo.checkingUrl = url;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
      }
    });
    
    debugInfo.statusCode = response.status;
    
    // Read the response
    const html = await response.text();
    debugInfo.responseSize = html.length;
    
    // Simple check: look for clear indicators the username exists
    const pageContent = html.toLowerCase();
    
    // Strong indicators the account EXISTS
    if (pageContent.includes(`"screen_name":"${username.toLowerCase()}"`) ||
        pageContent.includes(`@${username.toLowerCase()}`) && pageContent.includes('followers')) {
      debugInfo.detected = 'Account exists - found username in page data';
      return { available: false, debug: debugInfo };
    }
    
    // Check if page says account doesn't exist
    if (pageContent.includes("this account doesn't exist") ||
        pageContent.includes("this account does not exist")) {
      debugInfo.detected = 'Account does not exist message found';
      return { available: true, debug: debugInfo };
    }
    
    // Check if account is suspended
    if (pageContent.includes('account suspended') || 
        pageContent.includes('account has been suspended')) {
      debugInfo.detected = 'Account is suspended';
      return { available: false, debug: debugInfo };
    }
    
    // If we get a 404, username might be available
    if (response.status === 404) {
      debugInfo.detected = '404 status - username likely available';
      return { available: true, debug: debugInfo };
    }
    
    // Default: if page loads with content, assume taken
    if (html.length > 10000) {
      debugInfo.detected = 'Large page size - likely a profile';
      return { available: false, debug: debugInfo };
    } else {
      debugInfo.detected = 'Small page size - might be error page';
      return { available: true, debug: debugInfo };
    }
    
  } catch (error) {
    console.error('Error in availability check:', error);
    // On error, assume not available to avoid false positives
    return { 
      available: false, 
      debug: { 
        error: error.message,
        ...debugInfo 
      }
    };
  }
}

async function sendSMS(message) {
  // Only try Twilio if configured
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.YOUR_PHONE_NUMBER) {
    console.log('SMS not configured');
    return null;
  }
  
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_FROM;
    const toPhone = process.env.YOUR_PHONE_NUMBER;
    
    // Create auth header
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    
    // Send SMS via Twilio
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
