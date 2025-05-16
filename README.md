# Insta Meme

A real-time token creation and monitoring system that automatically creates Solana tokens based on mentions on Instagram, TikTok, and X (Twitter). The system monitors social media platforms for specific mentions and automatically creates tokens on the Pump.fun platform.

## Features

- **Multi-Platform Monitoring**: Monitors Instagram, TikTok, and X (Twitter) for token mentions
- **Real-time Token Creation**: Automatically creates Solana tokens when mentioned
- **WebSocket Notifications**: Real-time updates via Socket.IO
- **Token History**: Maintains a history of all created tokens
- **IPFS Integration**: Stores token metadata on IPFS
- **Solana Integration**: Creates and manages tokens on the Solana blockchain
- **AI Agent (Amber)**: Intelligent agent that monitors and analyzes token creation patterns with a witty and engaging personality

## Prerequisites

- Node.js (v14 or higher)
- Solana CLI tools
- Instagram account
- Apify account (for TikTok scraping)
- X (Twitter) API credentials

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Solana Configuration
SOLANA_RPC_URL=your_solana_rpc_url
PUMP_PRIVATE_KEY=your_private_key

# Instagram Configuration
IG_USERNAME=your_instagram_username
IG_PASSWORD=your_instagram_password
IG_USER_ID=your_instagram_user_id
POLL_INTERVAL=120  # in seconds

# Apify Configuration (for TikTok)
APIFY_TOKEN=your_apify_token

# X (Twitter) Configuration
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret
TWITTER_ACCESS_TOKEN=your_twitter_access_token
TWITTER_ACCESS_SECRET=your_twitter_access_secret
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/pauly00n/instadotmeme/
cd insta-meme
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables as described above

4. Start the server:
```bash
npm start
```

## How It Works

### Instagram Monitoring
- Monitors Instagram user tags for mentions in the format `@instadotmeme + [name]/[ticker]`
- Automatically captures post images and creates tokens
- Maintains session state for continuous monitoring

### TikTok Monitoring
- Uses Apify's TikTok scraper to monitor specific sounds
- Monitors videos using the [official sound](https://www.tiktok.com/music/original-sound-instadotmeme-7502290236177763118)
- Processes mentions in the format `@instameme + [name]/[ticker]`
- Captures video thumbnails for token creation
- Only processes videos that use the official sound

### X (Twitter) Monitoring
- Monitors Twitter mentions and replies
- Processes mentions in the format `@amberdotmeme + [name]/[ticker]`
- Captures tweet media for token creation
- Real-time token creation from Twitter interactions

### Token Creation
- Creates Solana tokens using the Pump.fun platform
- Uploads token metadata to IPFS
- Generates unique mint addresses for each token
- Maintains a history of all created tokens

### Amber AI Agent
- Intelligent monitoring system that analyzes token creation patterns
- Provides real-time insights and analytics
- Helps identify trending tokens and patterns
- Integrates with the WebSocket system for real-time updates
- Assists in monitoring token performance and social media engagement
- Features a witty and engaging personality that makes monitoring fun
- Responds with humor and personality to token creation events
- Provides entertaining commentary on token trends and market movements
- Maintains a consistent and friendly presence across all platforms

### Real-time Updates
- WebSocket server for real-time token notifications
- Clients can connect to receive instant updates
- Supports multiple concurrent connections
- Amber AI agent provides additional analytics and insights with personality

## API Endpoints

- `GET /api/token-history`: Returns the history of created tokens
- `GET /api/test-emit`: Emits a test token for debugging
- WebSocket endpoint for real-time token updates
- Amber AI agent provides additional analytics endpoints with personality-driven responses

## Security Considerations

- Private keys are stored in environment variables
- Instagram session state is persisted securely
- Rate limiting and throttling implemented for API calls
- Amber AI agent implements secure data handling and analysis
- Social media API credentials are securely managed

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## Support

For support, please contact developers@insta.meme
