// api/check-username.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  const USERNAME_TO_CHECK = 'zubin';
  const SECRET_KEY = process.env.SECRET_KEY || 'your-secret-key-here';
  
  const { key, sendAlert } = req.query;
  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const isAvailable = await checkUsernameAvailability(USERNAME_TO_CHECK);
    
    if (sendAlert === 'true' && isAvailable) {
      await sendSMS(`🚨 @${USERNAME_TO_CHECK} is NOW AVAILABLE on X! Claim it at x.com/${USERNAME_TO_CHECK}`);
    }
    
    res.status(200).json({
      username: USERNAME_TO_CHECK,
      available: isAvailable,
      timestamp: new Date().toISOString(),
      message: isAvailable ? 'Username is available!' : 'Username is taken or suspended'
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to check username',
      details: error.message 
    });
  }
}

async function checkUsernameAvailability(username) {
  try {
    const response = await fetch(`https://x.com/${username}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      redirect: 'follow'
    });
    
    if (response.status === 404) {
      return true;
    }
    
    const text = await response.text();
    const availabilityIndicators = [
      'this account doesn\'t exist',
      'this account has been suspended',
      'page doesn\'t exist',
      'something went wrong'
    ];
    
    const textLower = text.toLowerCase();
    return availabilityIndicators.some(indicator => textLower.includes(indicator));
    
  } catch (error) {
    console.error('Error checking username:', error);
    throw error;
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
