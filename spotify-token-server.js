// spotify-token-server.js
// Node.js/Express server to provide a Spotify access token using Authorization Code flow
// Usage: Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI as environment variables

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const querystring = require('querystring');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration - Use environment variables in production
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'a6658dcb4e79434fac7345644f921d50';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'c76820f7cf5e42f9ab9292866a30e99b';
// Allow different redirect URIs for development vs production
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'https://hitser-practice.netlify.app/';

// Determine if we're in production
const isProduction = process.env.NODE_ENV === 'production';

// Support both local and production environments
const FRONTEND_URIS = {
    local: 'http://localhost:63342/Playground/hitser',
    production: 'https://hitser-practice.netlify.app'
};

// Use the appropriate frontend URI based on environment
const FRONTEND_URI = isProduction ? FRONTEND_URIS.production : FRONTEND_URIS.local;

// Session storage (in a production app, use a proper session store)
let userTokens = {};
// Store pending authorization requests
let pendingRequests = {};

app.use(cors({
    // Allow requests from both local development and production domains
    origin: [FRONTEND_URIS.local, FRONTEND_URIS.production, 'http://localhost:3001', '*']
}));
app.use(express.json());

// Root route that provides instructions
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Spotify Auth Server</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
                    code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
                    .container { max-width: 800px; margin: 0 auto; }
                    .info { background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0; }
                    .warning { background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; }
                    .buttons { display: flex; gap: 10px; margin-bottom: 20px; }
                    .btn { padding: 10px 15px; background: #1DB954; color: white; text-decoration: none; 
                           border-radius: 5px; font-weight: bold; border: none; cursor: pointer; }
                    .tab-container { border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
                    .tabs { display: flex; gap: 10px; margin-bottom: 15px; }
                    .tab-btn { padding: 8px 16px; border: none; background: #eee; cursor: pointer; border-radius: 4px; }
                    .tab-btn.active { background: #1DB954; color: white; }
                    .hidden { display: none !important; }
                    .success-banner { background: #4CAF50; color: white; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                    .server-info { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 30px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Spotify Authorization Server</h1>
                    <p>This server handles Spotify authentication for the Hitster game.</p>
                    
                    <div class="server-info">
                        <h3>Server Information</h3>
                        <p>Environment: ${isProduction ? 'Production' : 'Development'}</p>
                        <p>Server URL: ${req.protocol}://${req.get('host')}</p>
                        <p>Frontend URL: ${FRONTEND_URI}</p>
                    </div>
                    
                    <div id="success-message" class="success-banner hidden">
                        <h2>✅ Authentication Successful!</h2>
                        <p>You've successfully authenticated with Spotify. Your app should now work with Spotify playback.</p>
                        <p>You can close this window and continue using the app.</p>
                    </div>
                    
                    <div id="login-section">
                        <div class="buttons">
                            <a href="/login?env=local" class="btn">Login for Local Development</a>
                            <a href="/login?env=production" class="btn">Login for Production App</a>
                        </div>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// Health check endpoint - returns 200 OK
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is healthy and running' });
});

// Login route - redirects to Spotify authorization
app.get('/login', (req, res) => {
    // Generate a random state to prevent CSRF attacks
    const state = crypto.randomBytes(8).toString('hex');
    // Store the state with additional info
    pendingRequests[state] = {
        timestamp: Date.now(),
        env: req.query.env || 'production' // Default to production
    };

    // Choose the appropriate redirect URI based on environment
    const redirectUri = req.query.env === 'local' ?
        encodeURIComponent(FRONTEND_URIS.local) :
        encodeURIComponent(REDIRECT_URI);

    // Redirect to Spotify authorization page
    const scope = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';

    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: CLIENT_ID,
            scope: scope,
            redirect_uri: redirectUri,
            state: state,
            show_dialog: true
        })
    );
});

// Callback route - processes the authorization code from Spotify
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const error = req.query.error || null;

    // Validate state to prevent CSRF
    if (error || !state || !pendingRequests[state]) {
        console.error('Error in callback:', error || 'Invalid state');
        return res.redirect(`/?error=${error || 'state_mismatch'}`);
    }

    // Get the environment from stored state
    const {env} = pendingRequests[state];
    // Clean up the pending request
    delete pendingRequests[state];

    // Choose the appropriate redirect URI based on stored environment
    const redirectUri = env === 'local' ? FRONTEND_URIS.local : REDIRECT_URI;

    try {
        // Exchange authorization code for access token
        const tokenResponse = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            params: {
                code: code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (tokenResponse.status === 200) {
            // Store the tokens with a session ID
            const sessionId = crypto.randomBytes(16).toString('hex');
            userTokens[sessionId] = {
                access_token: tokenResponse.data.access_token,
                refresh_token: tokenResponse.data.refresh_token,
                expires_at: Date.now() + tokenResponse.data.expires_in * 1000
            };

            // Redirect back to the frontend with the session ID
            const frontendUri = env === 'local' ? FRONTEND_URIS.local : FRONTEND_URIS.production;
            return res.redirect(`${frontendUri}?session_id=${sessionId}`);
        } else {
            console.error('Token exchange failed:', tokenResponse.data);
            return res.redirect(`/?error=token_exchange_failed`);
        }
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        return res.redirect(`/?error=token_exchange_error`);
    }
});

// Get Spotify token with session ID
app.get('/spotify-token', async (req, res) => {
    const sessionId = req.query.session_id;

    if (!sessionId || !userTokens[sessionId]) {
        return res.status(401).json({error: 'Invalid or expired session'});
    }

    const tokenData = userTokens[sessionId];

    // Check if the token needs to be refreshed
    if (Date.now() >= tokenData.expires_at) {
        try {
            // Refresh the token
            const refreshResponse = await axios({
                method: 'post',
                url: 'https://accounts.spotify.com/api/token',
                params: {
                    grant_type: 'refresh_token',
                    refresh_token: tokenData.refresh_token
                },
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            // Update stored token data
            tokenData.access_token = refreshResponse.data.access_token;
            tokenData.expires_at = Date.now() + refreshResponse.data.expires_in * 1000;

            if (refreshResponse.data.refresh_token) {
                tokenData.refresh_token = refreshResponse.data.refresh_token;
            }
        } catch (error) {
            console.error('Error refreshing token:', error.response?.data || error.message);
            return res.status(500).json({error: 'Token refresh failed'});
        }
    }

    // Return the current access token
    res.json({access_token: tokenData.access_token});
});

// Spotify search token endpoint - provides a client credentials token for searches
app.get('/spotify-search-token', async (req, res) => {
    try {
        // Get a client credentials token (different from user auth flow)
        const tokenResponse = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            params: {
                grant_type: 'client_credentials'
            },
            headers: {
                'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (tokenResponse.status === 200) {
            // Return just the access token and expiration
            return res.json({
                access_token: tokenResponse.data.access_token,
                expires_in: tokenResponse.data.expires_in
            });
        } else {
            console.error('Client credentials token exchange failed:', tokenResponse.data);
            return res.status(500).json({ error: 'Failed to get search token' });
        }
    } catch (error) {
        console.error('Error getting client credentials token:', error.response?.data || error.message);
        return res.status(500).json({ error: 'Token exchange error' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Spotify token server running on http://localhost:${PORT}`);
});
