import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import { OpenAI }     from 'openai';
import axios          from 'axios';
import fs             from 'fs/promises';
import { createToken } from '../src/pumpfun.js';


const oauth2Client = new TwitterApi(
  {
    clientId:     process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
  },
  {
    enableRateLimit: true,
  }
);


const {
  client: twitter,     
  accessToken,         
  refreshToken         
} = await oauth2Client.refreshOAuth2Token(
  process.env.TWITTER_OAUTH2_REFRESH_TOKEN
);
console.log('Twitter OAuth2 client initialized');

const aiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
console.log('OpenAI client initialized');


const dexscreener = axios.create({ baseURL: 'https://api.dexscreener.com' });
console.log('DexScreener client initialized');

let botUserId;
const seenMentions = new Set();


const MIN_DELAY_MS              = 22 * 60 * 1000;      
const MAX_DELAY_MS              = 3.42 * 3600 * 1000;  
const NORMAL_MENTION_INTERVAL   = 2 * 60 * 1000;       


console.log('Reading CT.txt for influencer handles…');
const influencerHandles = (
  await fs.readFile(new URL('./CT.txt', import.meta.url), 'utf-8')
)
  .split(/\r?\n/)
  .map(l => l.trim().replace(/^@/, ''))
  .filter(Boolean);
console.log('Loaded influencer handles:', influencerHandles);

const influencerMap = {};  


const entityFunction = {
  name: "extract_entities",
  description: "extract tickers names and slang from tweet text",
  parameters: {
    type: "object",
    properties: {
      tickers: { type: "array", items: { type: "string" } },
      names:   { type: "array", items: { type: "string" } },
      slang:   { type: "array", items: { type: "string" } }
    },
    required: ["tickers","names","slang"]
  }
};

const examples = [
  { role: "system", content: "you are a precise entity extractor for crypto tweets respond only with function_call no punctuation or emojis" },
  { role: "user",   content: "just bought some bitcoin and solana before the next pump" },
  { role: "assistant", function_call: { name: "extract_entities", arguments: {"tickers":[],"names":["bitcoin","solana"],"slang":[]} } },
  { role: "user",   content: "lambo gang going ape on dogecoin right now haha" },
  { role: "assistant", function_call: { name: "extract_entities", arguments: {"tickers":["DOGE"],"names":[],"slang":["lambo gang","ape"]} } },
];


async function resolveInfluencers() {
  console.log('Resolving influencer handles to user IDs…');
  for (const handle of influencerHandles) {
    try {
      const resp = await twitter.v2.userByUsername(handle);
      influencerMap[handle] = resp.data.id;
      console.log(`Resolved @${handle} → ${resp.data.id}`);
    } catch {
      console.warn(`could not resolve @${handle}`);
    }
  }
}


function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function fetchNewInfluencerTweets() {
  console.log('Fetching new influencer tweets…');
  const tweets = [];
  const handles = Object.keys(influencerMap);
  for (const grp of chunk(handles, 20)) {
    const query = grp.map(h => `from:${h}`).join(' OR ');
    const res = await twitter.v2.search(query, {
      max_results:    50,
      'tweet.fields': ['entities','text','id']
    });
    (res.data || []).forEach(t => tweets.push(t));
  }
  console.log(`Total tweets fetched: ${tweets.length}`);
  return tweets;
}


async function extractEntitiesGPT(text) {
  console.log('Extracting entities via GPT for text:', text);
  const resp = await aiClient.chat.completions.create({
    model:     "gpt-4",
    messages:  [...examples, { role: "user", content: text }],
    functions: [entityFunction],
    function_call: { name: "extract_entities" }
  });
  const args = JSON.parse(resp.choices[0].message.function_call.arguments);
  console.log('Entities extracted:', args);
  return args;
}


async function normalizeEntities({ tickers, names, slang }) {
  console.log('Normalizing entities via DexScreener:', { tickers, names, slang });
  const canonical = new Set(tickers);
  for (const term of [...names, ...slang]) {
    try {
      console.log(`→ Searching DexScreener for term: ${term}`);
      const res = await dexscreener.get(`/latest/dex/search?q=${encodeURIComponent(term)}`);
      const pair = res.data.pairs?.[0];
      const sym  = pair?.baseToken?.symbol;
      if (sym) {
        canonical.add(sym.toUpperCase());
        console.log(`Matched ${term} → ${sym.toUpperCase()}`);
      }
    } catch {
      console.warn(`DexScreener search failed for term: ${term}`);
    }
  }
  const result = [...canonical];
  console.log('Normalized entities to:', result);
  return result;
}


function rankEntities(all) {
  console.log('Ranking entities frequency over all mentions:', all);
  const freq = {};
  all.flat().forEach(sym => {
    freq[sym] = (freq[sym]||0) + 1;
  });
  return Object.entries(freq)
    .sort(([,a],[,b]) => b - a)
    .map(([sym]) => sym);
}


async function filterToMemecoins(tickers) {
  console.log('Filtering to memecoins via DexScreener trending:', tickers);
  try {
    const res = await dexscreener.get('/latest/dex/trending');
    const trendingSymbols = res.data.pairs.map(p => p.baseToken.symbol.toUpperCase());
    const memes = tickers.filter(sym => trendingSymbols.includes(sym.toUpperCase()));
    return memes.length ? memes : tickers.slice(0,3);
  } catch {
    console.warn('DexScreener trending fetch failed');
    return tickers.slice(0,3);
  }
}


async function tweetInfluencerTrend() {
  console.log('Running tweetInfluencerTrend');
  const tweets = await fetchNewInfluencerTweets();
  if (!tweets.length) return;

  const raw    = await Promise.all(tweets.map(t => extractEntitiesGPT(t.text)));
  const norm   = await Promise.all(raw.map(e => normalizeEntities(e)));
  const ranked = rankEntities(norm);
  const trend  = await filterToMemecoins(ranked);
  if (!trend.length) return;

  const top    = trend.slice(0,3).join(', ');
  const prompt = `
you are amber the snarky ai agent for insta meme
several influencers are hyping these memecoins on crypto twitter ${top}
roast that unstoppable memecoin mania in one tweet
respond only in lowercase letters with no punctuation or emojis
`;
  const resp = await aiClient.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role:'user', content: prompt }],
    max_tokens: 60
  });
  await twitter.v2.tweet({ text: resp.choices[0].message.content.trim() });
  console.log('Influencer trend tweet posted');
}


async function fetchSolanaSeeds() {
  console.log('Fetching Solana seeds via DexScreener trending…');
  try {
    const res = await dexscreener.get('/latest/dex/trending');
    const solPairs = res.data.pairs.filter(p => p.chain?.toLowerCase() === 'solana');
    const seeds = solPairs.map(p => p.baseToken.symbol.toUpperCase());
    return seeds.length ? seeds : ['SOL'];
  } catch {
    console.warn('DexScreener solana seeds fetch failed');
    return ['SOL'];
  }
}


async function fetchTweets(query, max = 50) {
  const res = await twitter.v2.search(query, {
    'tweet.fields': 'public_metrics',
    max_results:    max
  });
  return res.data || [];
}

function analyzeMetrics(tweets) {
  if (!tweets.length) return { avgSent:0, avgEng:0 };
  let totalSent = 0, totalEng = 0;
  for (const t of tweets) {
    totalSent += t.text.length/280;
    totalEng  += t.public_metrics.retweet_count + t.public_metrics.like_count;
  }
  return { avgSent: totalSent/tweets.length, avgEng: totalEng/tweets.length };
}

function scoreMoon(sent, eng) {
  const engNorm = Math.min(1, eng/100);
  return Math.round(sent*50 + engNorm*50);
}

function decide(score) {
  return score >= 70 ? 'go for launch'
       : score >= 40 ? 'meh needs more juice'
       :                'too flat';
}

async function roast(trend, metrics, decision) {
  const prompt = `
you are amber the snarky ai agent for insta meme stanford sophomore paul yoon's solana pumpfun memecoin launcher
your mission
mine social chatter for undertheradar solana memecoins
score moon potential 0 to 100
deliver a snarky oneliner followed by a summary line sentiment ${metrics.avgSent.toFixed(2)} engagement ${metrics.avgEng.toFixed(1)} score ${metrics.score} arrow ${decision}
trend ${trend}
respond only in lowercase letters with no punctuation or emojis
`;
  const res = await aiClient.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role:'user', content: prompt }],
    max_tokens: 120
  });
  return res.choices[0].message.content.trim();
}


async function assessCoinProposal(proposal) {
  console.log(`Assessing "${proposal}" via DexScreener…`);

  
  const searchRes = await dexscreener.get(`/latest/dex/search?q=${encodeURIComponent(proposal)}`);
  const sims = searchRes.data.pairs
    .map(p => p.baseToken.symbol.toUpperCase())
    .filter(sym => sym !== proposal.toUpperCase())
    .slice(0, 3);

  
  const trendRes = await dexscreener.get('/latest/dex/trending');
  const trending = trendRes.data.pairs;

  
  const perf = sims.map(sym => {
    const pair = trending.find(p => p.baseToken.symbol.toUpperCase() === sym);
    const change = pair?.priceChange24hPercent ?? 0;
    return { symbol: sym, change: change.toFixed(1) };
  });

  const lines = perf.length
    ? perf.map(p => `• ${p.symbol} ${p.change}% over 24h`).join('\n')
    : '• no clear peers found';

  
  const prompt = `
you are amber the snarky ai agent for insta meme
a user asked if launching ${proposal.toUpperCase()} is a good idea
here is how similar tokens performed recently
${lines}
give a snarky two- or three-sentence verdict on whether ${proposal.toUpperCase()} is smart or just hype
respond only in lowercase letters with no punctuation or emojis
`;
  const res = await aiClient.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 80
  });
  return res.choices[0].message.content.trim();
}


async function replyGeneral(mention) {
  const txt = mention.text.replace(/@amber\.meme/gi, '').trim();
  const prompt = `
you are amber the snarky ai agent for insta meme
when asked about anything not related to memecoins or token minting reply like a normal human with your signature snark
user says ${txt}
respond only in lowercase letters with no punctuation or emojis
`;
  const res = await aiClient.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role:'user', content: prompt }],
    max_tokens: 100
  });
  return res.choices[0].message.content.trim();
}


async function checkMentions() {
  console.log('Checking mentions');
  console.log('botUserId is', botUserId);

  try {
    let resp;
    try {
      resp = await twitter.v2.userMentionTimeline(botUserId, {
        max_results:    20,
        expansions:     ['attachments.media_keys','author_id'],
        'media.fields': ['url'],
        'tweet.fields': ['entities','text','attachments']
      });
    } catch (e) {
      if (e.rateLimit?.remaining === 0 && e.rateLimit.reset) {
        const resetMs = e.rateLimit.reset * 1000;
        const delay   = Math.max(0, resetMs - Date.now()) + 1000;
        console.warn(`Rate limited. Next attempt in ${Math.ceil(delay/1000)}s`);
        return scheduleNextMentionCheck(delay);
      }
      console.error('error fetching mentions', e);
      throw e; 
    }

    
    const mentions = Array.isArray(resp.data)
      ? resp.data
      : Array.isArray(resp.data?.data)
        ? resp.data.data
        : [];
    
    console.log(`found ${mentions.length} mentions`);

    const mediaMap = (resp.includes?.media || [])
      .reduce((m,i) => { m[i.media_key] = i; return m; }, {});

    for (const m of [...mentions].reverse()) {
      if (seenMentions.has(m.id)) continue;
      seenMentions.add(m.id);

      try {
        const rawText = m.text.replace(/@amberdotmeme/gi, '').trim();
        const txt = rawText.toLowerCase();
        const hasImage = Array.isArray(m.attachments?.media_keys);
        const isMint = txt.includes('/') && hasImage;
        const isTickerOnly = /^[a-z0-9]{2,6}$/.test(txt);
        const isDeployQuestion = /deployed.*would it do (good|well)/i.test(txt);

        if (isMint) {
          try {
            
            console.log(`Detected mint request in mention ${m.id}:`, txt);
            
            
            const regex = /@amberdotmeme*(?:\+)?\s*([A-Za-z0-9 _-]+)[\/\-]([^\s]+)/i;
            const matches = regex.exec(m.text);
            
            let name, ticker;
            if (matches && matches.length >= 3) {
              name = matches[1].trim();
              ticker = matches[2].trim();
            } else {
              
              const parts = txt.split(/\s+/)[0].split('/');
              name = parts[0];
              ticker = parts[1];
            }
            
            console.log(`Parsed name=${name}, ticker=${ticker}`);
            
            const mediaKey = m.attachments.media_keys[0];
            const url      = mediaMap[mediaKey]?.url;
            console.log(`Downloading image from ${url}`);
            const buf         = await axios.get(url, { responseType:'arraybuffer' });
            const imageBase64 = Buffer.from(buf.data).toString('base64');
            console.log('Image downloaded and encoded');
            const tweetUrl = `https://twitter.com/${m.author_id}/status/${m.id}`;
            const result   = await createToken(name, ticker, imageBase64, tweetUrl);
            console.log('Token creation result:', result);

            const mintPrompt = `
you are amber the snarky ai agent for insta meme
a user @${m.author_id} requested name ${name} ticker ${ticker} link ${result.success?result.pumpFunLink:'na'}
${result.success
  ? 'compose a playful sarcastic oneliner announcing that the token is live and include the link'
  : `compose a witty apology referencing the error ${result.error}`}
respond only in lowercase letters with no punctuation or emojis
`;
            console.log('   → GPT prompt for mint reply:', mintPrompt.trim());
            const r = await aiClient.chat.completions.create({
              model:'gpt-4',
              messages:[{ role:'user', content: mintPrompt }],
              max_tokens: 80
            });
            const reply = r.choices[0].message.content.trim();
            console.log('Generated mint reply:', reply);
            await twitter.v2.tweet({
              text: reply,
              reply: { in_reply_to_tweet_id: m.id }
            });
            console.log(`Mint reply posted for ${m.id}`);
          } catch (mintError) {
            console.error(`Failed to process mint request for ${m.id}:`, mintError);
          }
          continue;
        }

        if (isTickerOnly || isDeployQuestion) {
          try {
            console.log(`Detected assessment request: ${txt}`);
            let proposal = txt;
            if (!isTickerOnly) {
              const ents = await extractEntitiesGPT(rawText);
              proposal = (ents.tickers[0] || ents.names[0] || txt).toUpperCase();
            }
            const verdict = await assessCoinProposal(proposal);
            console.log(`Posting assessment reply: ${verdict}`);
            await twitter.v2.tweet({
              text: verdict,
              reply: { in_reply_to_tweet_id: m.id }
            });
            console.log(`Assessment reply posted for ${m.id}`);
          } catch (assessError) {
            console.error(`Failed to process assessment request for ${m.id}:`, assessError);
          }
          continue;
        }

        try {
          console.log(`Treating as general mention`);
          const gen = await replyGeneral(m);
          console.log(`Generated general reply: ${gen}`);
          await twitter.v2.tweet({
            text: gen,
            reply: { in_reply_to_tweet_id: m.id }
          });
          console.log(`General reply posted for ${m.id}`);
        } catch (generalError) {
          console.error(`Failed to process general mention for ${m.id}:`, generalError);
        }
      } catch (mentionError) {
        console.error(`Failed to process mention ${m.id}:`, mentionError);
      }
    }
  } catch (error) {
    console.error('Error in checkMentions:', error);
  } finally {
    
    scheduleNextMentionCheck(NORMAL_MENTION_INTERVAL);
    console.log('Scheduled next mention check');
  }
}

function scheduleNextMentionCheck(delayMs) {
  setTimeout(checkMentions, delayMs);
}


async function tweetAuto() {
  console.log('Running tweetAuto');
  const seeds = await fetchSolanaSeeds();
  const r     = Math.random();
  let prompt;

  if (r < 0.30 && seeds.length) {
    prompt = `
you are amber the snarky ai agent for insta meme
roast this undertheradar solana memecoin ${seeds[Math.floor(Math.random()*seeds.length)]} in one tweet playful sarcasm style
respond only in lowercase letters with no punctuation or emojis
`;
  } else if (r < 0.55) {
    prompt = `
you are amber the snarky ai agent for insta meme
write a spicy oneline tweet mocking crypto twitter hype around ${seeds[Math.floor(Math.random()*seeds.length)]||'sol'}
respond only in lowercase letters with no punctuation or emojis
`;
  } else if (r < 0.70) {
    prompt = `
you are amber the snarky ai agent for insta meme
tweet a snarky oneliner about something fresh happening in the solana ecosystem right now mention a project or trend
respond only in lowercase letters with no punctuation or emojis
`;
  } else {
    prompt = `
you are amber the snarky ai agent for insta meme
share a random offbeat thought or snarky observation that shows off your personality under 280 characters
respond only in lowercase letters with no punctuation or emojis
`;
  }

  const res = await aiClient.chat.completions.create({
    model:'gpt-4',
    messages:[{ role:'user', content: prompt }],
    max_tokens: 70
  });
  await twitter.v2.tweet({ text: res.choices[0].message.content.trim() });
}

function scheduleNextAutoTweet() {
  const delay = Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS) + MIN_DELAY_MS;
  setTimeout(async () => {
    try { await tweetAuto(); }
    catch (e) { console.error('auto tweet error', e); }
    scheduleNextAutoTweet();
  }, delay);
}

export async function startAmberAgent() {
  const me = await twitter.v2.me();
  botUserId = me.data.id;
  console.log('Bot user ID is', botUserId);

  await resolveInfluencers();
  scheduleNextMentionCheck(0);
  scheduleNextAutoTweet();
  setInterval(tweetInfluencerTrend, 10 * 60_000);
} 


(async () => {
  console.log('Startup sequence');
  await startAmberAgent();
})(); 
