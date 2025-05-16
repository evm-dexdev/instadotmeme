// tiktok.js
import { ApifyClient } from 'apify-client';
import axios from 'axios';
import { createToken } from './pumpfun.js';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  throw new Error('Missing APIFY_TOKEN environment variable');
}

const client = new ApifyClient({ token: APIFY_TOKEN });
const processedUrls = new Set();
const mentionPattern = /@insta\.meme\s*\+\s*([^\/\s]+)\/([^\/\s]+)/i;

/**
 * 
 * @param {import("socket.io").Server} io
 */
export function startTikTok(io) {
  async function scrapeAndProcess() {
    console.log(`[${new Date().toISOString()}] Running TikTok`);
    try {
      const run = await client
        .actor('clockworks/tiktok-sound-scraper')
        .call({
          musics: [
            'https://www.tiktok.com/music/original-sound-instadotmeme-7502290236177763118'
          ],
          resultsPerPage: 100,
          shouldDownloadVideos: false,
          shouldDownloadCovers: false,
          shouldDownloadSubtitles: false,
          shouldDownloadSlideshowImages: false,
          shouldDownloadMusicCovers: false,
        });

      const { items } = await client
        .dataset(run.defaultDatasetId)
        .listItems();

      const matches = items.filter(item => mentionPattern.test(item.text));
      if (!matches.length) {
        console.log('No new matching captions this round.');
        return;
      }

      for (const item of matches) {
        const { text, webVideoUrl, videoMeta } = item;
        if (processedUrls.has(webVideoUrl)) continue;
        processedUrls.add(webVideoUrl);

        const [, name, ticker] = text.match(mentionPattern);
        console.log(`Found new mention: ${name}/${ticker} @ ${webVideoUrl}`);

        let imageBuffer;
        try {
          const imgRes = await axios.get(videoMeta.coverUrl, {
            responseType: 'arraybuffer',
          });
          imageBuffer = Buffer.from(imgRes.data, 'binary').toString('base64');
        } catch (fetchErr) {
          console.error('Failed to fetch thumbnail:', fetchErr);
          continue;
        }

        let result;
        try {
          result = await createToken(name, ticker, imageBuffer, webVideoUrl);
        } catch (tokenErr) {
          console.error('Error in createToken():', tokenErr);
          continue;
        }

        if (!result.success) {
          console.error('Token creation failed:', result.error);
          continue;
        }

        
        const tokenInfo = {
          name,
          ticker,
          pumpFunLink: result.pumpFunLink,
          instagramPost: webVideoUrl,
          timestamp: new Date().toISOString(),
          mintAddress: result.mintAddress,
          imageData: `data:image/png;base64,${imageBuffer}`,
          platform: 'TikTok'
        };

        
        const { imageData, ...logInfo } = tokenInfo;
        console.log('Emitting newToken:', logInfo);

        io.emit('newToken', tokenInfo);
      }

    } catch (err) {
      console.error('Error during TikTok:', err);
    }
  }

  scrapeAndProcess();
  setInterval(scrapeAndProcess, 60 * 1000);
}
