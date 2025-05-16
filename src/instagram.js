import { IgApiClient, IgCheckpointError, IgLoginBadPasswordError } from 'instagram-private-api';
import fs from 'fs';
import axios from 'axios';
import { createToken } from './pumpfun.js';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const {
  IG_USERNAME,
  IG_PASSWORD,
  IG_USER_ID,      // Numeric Instagram User ID
  POLL_INTERVAL    // in seconds, e.g. 60
} = process.env;

if (!IG_USERNAME || !IG_PASSWORD || !IG_USER_ID) {
  console.error('IG_USERNAME, IG_PASSWORD, and IG_USER_ID must be set in .env');
  process.exit(1);
}


const processedShortcodes = new Set();


function throttle(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise(res => setTimeout(res, ms));
}


function promptForCode(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(promptText, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}



async function loginIg() {
  const ig = new IgApiClient();
  ig.state.generateDevice(IG_USERNAME);

 
  if (fs.existsSync('./ig-state.json')) {
    try {
      const saved = fs.readFileSync('./ig-state.json', 'utf8');
      ig.state.deserialize(JSON.parse(saved));
      console.log(' Session state restored');
    } catch (e) {
      console.warn(' Invalid session state, will login fresh');
    }
  }

  try {
    console.log(' Logging in to Instagram with credentials...');
    await ig.account.login(IG_USERNAME, IG_PASSWORD);
  } catch (err) {
    if (err instanceof IgLoginBadPasswordError) {
      console.error(' Login failed: Bad credentials');
      process.exit(1);
    } else if (err instanceof IgCheckpointError) {
      console.warn(' Checkpoint required, initiating 2FA flow...');
      const { step_name } = await ig.challenge.auto(true);
      console.log(` Verification code sent via ${step_name}`);
      const code = await promptForCode('Enter the verification code: ');
      await ig.challenge.sendSecurityCode(code);
      console.log(' Checkpoint passed, retrying login');
      await ig.account.login(IG_USERNAME, IG_PASSWORD);
    } else {
      console.error(' Login failed:', err.message || err);
      throw err;
    }
  }

  
  try {
    const newState = await ig.state.serialize();
    fs.writeFileSync('./ig-state.json', JSON.stringify(newState));
    console.log(' Login successful, session saved');
  } catch {
    console.warn(' Could not save session state');
  }

  return ig;
}


export async function startInstagram(io) {
  const ig = await loginIg();

  
  io.emit('monitorStarted', { timestamp: new Date().toISOString(), message: 'Monitor started' });
  console.log(' Monitor started');

  while (true) {
    try {
      
      await throttle(5000, 10000);  

      const feed = ig.feed.usertags(IG_USER_ID);
      const items = await feed.items();

      for (const media of items) {
        
        await throttle(2000, 5000); 

        const shortcode = media.code;
        if (!shortcode || processedShortcodes.has(shortcode)) continue;
        processedShortcodes.add(shortcode);

        const caption = media.caption?.text || '';
        console.log(' Caption:', caption);

        const match = caption.match(/@instadotmeme\s*(?:\+)?\s*([A-Za-z0-9 _-]+)[\/\-]([^\s]+)/i);
        if (!match) continue;

        const name = match[1].trim();
        const ticker = match[2].trim();
        console.log(`Parsed name=${name}, ticker=${ticker}`);

        
        const mediaUrl = media.image_versions2?.candidates[0]?.url
          || media.carousel_media?.[0]?.image_versions2?.candidates[0]?.url;
        if (!mediaUrl) continue;

        
        const resp = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
        const screenshot = Buffer.from(resp.data).toString('base64');
        const postUrl = `https://www.instagram.com/p/${shortcode}/`;

        
        const result = await createToken(name, ticker, screenshot, postUrl);
        if (!result.success) {
          console.error(' createToken failed:', result.error);
          continue;
        }

        
        const tokenData = {
          name,
          ticker,
          pumpFunLink: `https://pump.fun/coin/${result.mintAddress}`,
          instagramPost: postUrl,
          timestamp: new Date().toISOString(),
          mintAddress: result.mintAddress,
          imageData: `data:image/png;base64,${screenshot}`,
          platform: 'Instagram'
        };
        
        try {
          
          io.emit('newToken', tokenData);
          console.log(` Token minted and notification sent: ${name}/${ticker}`);
          
          
          const historyFile = './token-history.json';
          let history = [];
          try {
            if (fs.existsSync(historyFile)) {
              history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
            }
          } catch (e) {
            console.warn(' Could not read token history file:', e.message);
          }
          
          history.push(tokenData);
          fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
        } catch (emitError) {
          console.error(' Failed to emit token event:', emitError);
        }
      }
    } catch (err) {
      console.error('Instagram loop error:', err.message || err);
    }

    
    const base = (POLL_INTERVAL || 120) * 1000;
    const jitter = (Math.random() - 0.5) * 60000; 
    await new Promise(res => setTimeout(res, base + jitter));
  }
}
