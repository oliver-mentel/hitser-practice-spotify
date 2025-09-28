// spotify-token-server.js
// Node.js/Express server to provide a Spotify access token using Authorization Code flow
// Usage: Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI as environment variables

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const querystring = require('querystring');

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
    origin: [FRONTEND_URIS.local, FRONTEND_URIS.production, 'http://localhost:3001']
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
                        
                        <div class="info">
                            <h2>How to Authenticate</h2>
                            <ol>
                                <li>Click one of the login buttons above based on which environment you want to use</li>
                                <li>You'll be redirected to Spotify to authorize</li>
                                <li>After authorizing, you'll be redirected to ${REDIRECT_URI}</li>
                                <li>Copy the full URL after redirection (including all parameters)</li>
                                <li>Return to this page and paste the URL below to complete authentication</li>
                            </ol>
                        </div>
                        
                        <div class="tab-container">
                            <div class="tabs">
                                <button class="tab-btn active" onclick="switchTab('auth-tab')">Complete Authentication</button>
                                <button class="tab-btn" onclick="switchTab('status-tab')">Check Token Status</button>
                            </div>
                            
                            <div id="auth-tab">
                                <h2>Complete Authentication</h2>
                                <p>After being redirected to ${REDIRECT_URI}, paste the full redirect URL here:</p>
                                <input type="text" id="redirectUrl" placeholder="${REDIRECT_URI}?code=..." style="width:80%; padding:8px;">
                                <button id="completeAuth" class="btn" style="padding:8px;">Complete Authentication</button>
                                <div id="result" style="margin-top: 15px;"></div>
                            </div>
                            
                            <div id="status-tab" style="display:none;">
                                <h2>Check Token Status</h2>
                                <p>Enter your session ID to check if your token is valid:</p>
                                <input type="text" id="sessionId" placeholder="Enter session ID" style="width:80%; padding:8px;">
                                <button id="checkToken" class="btn" style="padding:8px;">Check Token</button>
                                <div id="tokenStatus" style="margin-top: 15px;"></div>
                            </div>
                        </div>
    
                        <div class="warning">
                            <h2>Spotify App Configuration</h2>
                            <p>Your Spotify app is configured with:</p>
                            <ul>
                                <li>Client ID: <code>${CLIENT_ID}</code></li>
                                <li>Redirect URI: <code>${REDIRECT_URI}</code></li>
                            </ul>
                        </div>
                    </div>
                </div>

                <script>
                    // Check if there's a session ID in URL params (auto-completed auth)
                    const urlParams = new URLSearchParams(window.location.search);
                    const autoSessionId = urlParams.get('session_id');
                    
                    if (autoSessionId) {
                        // Hide login section and show success message
                        document.getElementById('login-section').classList.add('hidden');
                        document.getElementById('success-message').classList.remove('hidden');
                        
                        // Clean URL
                        window.history.replaceState({}, document.title, window.location.pathname);
                    }
                
                    function switchTab(tabId) {
                        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                        document.querySelectorAll('.tab-container > div[id$="-tab"]').forEach(tab => tab.style.display = 'none');
                        document.querySelector(\`.tab-btn[onclick="switchTab('\${tabId}')"]\`).classList.add('active');
                        document.getElementById(tabId).style.display = 'block';
                    }
                
                    document.getElementById('completeAuth').addEventListener('click', async () => {
                        const redirectUrl = document.getElementById('redirectUrl').value;
                        if (!redirectUrl || !redirectUrl.includes('code=')) {
                            document.getElementById('result').innerHTML = '<p style="color:red;">Please enter a valid URL that includes the authorization code</p>';
                            return;
                        }

                        try {
                            // Extract the code from the URL
                            const url = new URL(redirectUrl);
                            const code = url.searchParams.get('code');
                            const state = url.searchParams.get('state');
                            
                            if (!code) {
                                document.getElementById('result').innerHTML = '<p style="color:red;">No authorization code found in the URL. Make sure to copy the full URL including query parameters.</p>';
                                return;
                            }

                            // Exchange code for token via our server
                            const response = await fetch('/exchange-code', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ code, state })
                            });
                            
                            const data = await response.json();
                            
                            if (data.session_id) {
                                // Hide login section and show success message
                                document.getElementById('login-section').classList.add('hidden');
                                document.getElementById('success-message').classList.remove('hidden');
                                
                                // Also show links to the apps
                                document.getElementById('success-message').innerHTML += \`
                                    <div style="margin-top: 20px;">
                                        <h3>Open the app:</h3>
                                        <p><a href="\${data.local_url}" target="_blank" class="btn">Open Local App</a></p>
                                        <p><a href="\${data.production_url}" target="_blank" class="btn">Open Production App</a></p>
                                        <p style="margin-top: 15px;">Your session ID: <code>\${data.session_id}</code></p>
                                    </div>
                                \`;
                            } else {
                                document.getElementById('result').innerHTML = '<p style="color:red;">Error: ' + (data.error || 'Unknown error') + '</p>';
                            }
                        } catch (error) {
                            document.getElementById('result').innerHTML = '<p style="color:red;">Error: ' + error.message + '</p>';
                        }
                    });
                    
                    document.getElementById('checkToken').addEventListener('click', async () => {
                        const sessionId = document.getElementById('sessionId').value;
                        if (!sessionId) {
                            document.getElementById('tokenStatus').innerHTML = '<p style="color:red;">Please enter a session ID</p>';
                            return;
                        }

                        try {
                            // Check token status
                            const response = await fetch('/check-token?session_id=' + sessionId);
                            const data = await response.json();
                            
                            if (data.valid) {
                                document.getElementById('tokenStatus').innerHTML = 
                                    '<p style="color:green;">Token is valid!</p>' +
                                    '<p>Expires in: ' + Math.round(data.expires_in / 60) + ' minutes</p>' +
                                    '<div style="margin: 20px 0;">' +
                                    '<h3>Open the app with this token:</h3>' +
                                    '<p><a href="' + '${FRONTEND_URIS.local}' + '?session_id=' + sessionId + '" target="_blank" class="btn">Open Local App</a></p>' +
                                    '<p><a href="' + '${FRONTEND_URIS.production}' + '?session_id=' + sessionId + '" target="_blank" class="btn">Open Production App</a></p>' +
                                    '</div>';
                                    
                                // Hide login section and show success message
                                document.getElementById('login-section').classList.add('hidden');
                                document.getElementById('success-message').classList.remove('hidden');
                                document.getElementById('success-message').innerHTML += \`
                                    <div style="margin-top: 20px;">
                                        <h3>Open the app:</h3>
                                        <p><a href="${FRONTEND_URIS.local}?session_id=\${sessionId}" target="_blank" class="btn">Open Local App</a></p>
                                        <p><a href="${FRONTEND_URIS.production}?session_id=\${sessionId}" target="_blank" class="btn">Open Production App</a></p>
                                    </div>
                                \`;
                            } else {
                                document.getElementById('tokenStatus').innerHTML = '<p style="color:red;">' + data.message + '</p>';
                            }
                        } catch (error) {
                            document.getElementById('tokenStatus').innerHTML = '<p style="color:red;">Error: ' + error.message + '</p>';
                        }
                    });
                </script>
            </body>
        </html>
    `);
});

// Step 1: Request authorization from user
app.get('/login', (req, res) => {
    console.log('Login route accessed');
    const state = generateRandomString(16);
    const scope = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';

    // Store environment preference in state
    const env = req.query.env || 'local';

    // Store the state for later validation
    pendingRequests[state] = {
        timestamp: Date.now(),
        env: env
    };

    // Clean up old pending requests (older than 10 minutes)
    cleanupPendingRequests();

    // Redirect to Spotify's authorization page
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: CLIENT_ID,
            scope: scope,
            redirect_uri: REDIRECT_URI,
            state: state,
            show_dialog: true
        }));
});

// Handle the code exchange manually
app.post('/exchange-code', async (req, res) => {
    const {code, state} = req.body;

    if (!code) {
        return res.status(400).json({error: 'Missing authorization code'});
    }

    // Retrieve environment preference from state if available
    const env = pendingRequests[state]?.env || 'local';

    try {
        // Exchange authorization code for access and refresh tokens
        const response = await axios.post('https://accounts.spotify.com/api/token',
            querystring.stringify({
                code: code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
                }
            }
        );

        const {access_token, refresh_token, expires_in} = response.data;

        // Store tokens with expiry time
        const sessionId = generateRandomString(16);
        userTokens[sessionId] = {
            access_token,
            refresh_token,
            expires_at: Date.now() + (expires_in * 1000)
        };

        // Return the session ID and redirect URLs for both environments
        res.json({
            session_id: sessionId,
            local_url: `${FRONTEND_URIS.local}?session_id=${sessionId}`,
            production_url: `${FRONTEND_URIS.production}?session_id=${sessionId}`
        });

        // Clean up the pending request
        if (state && pendingRequests[state]) {
            delete pendingRequests[state];
        }
    } catch (error) {
        console.error('Error exchanging code for tokens:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to exchange code for tokens',
            details: error.response?.data || error.message
        });
    }
});

// Check if a token is valid
app.get('/check-token', async (req, res) => {
    const sessionId = req.query.session_id;

    if (!sessionId || !userTokens[sessionId]) {
        return res.json({
            valid: false,
            message: 'Invalid or expired session. Please authenticate again.'
        });
    }

    const userToken = userTokens[sessionId];
    const now = Date.now();

    // Check if token is expired
    if (now > userToken.expires_at) {
        try {
            // Try to refresh the token
            const response = await axios.post('https://accounts.spotify.com/api/token',
                querystring.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: userToken.refresh_token
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
                    }
                }
            );

            // Update stored token
            userToken.access_token = response.data.access_token;
            userToken.expires_at = now + (response.data.expires_in * 1000);

            if (response.data.refresh_token) {
                userToken.refresh_token = response.data.refresh_token;
            }

            return res.json({
                valid: true,
                expires_in: userToken.expires_at - now
            });
        } catch (error) {
            console.error('Error refreshing token:', error);
            return res.json({
                valid: false,
                message: 'Token expired and could not be refreshed. Please authenticate again.'
            });
        }
    }

    // Token is valid
    return res.json({
        valid: true,
        expires_in: userToken.expires_at - now
    });
});

// Get access token with session ID
app.get('/spotify-token', async (req, res) => {
    const sessionId = req.query.session_id;

    if (!sessionId || !userTokens[sessionId]) {
        return res.status(401).json({error: 'Invalid or expired session'});
    }

    const userToken = userTokens[sessionId];

    // Check if token needs to be refreshed
    if (Date.now() > userToken.expires_at) {
        try {
            // Refresh the token
            const response = await axios.post('https://accounts.spotify.com/api/token',
                querystring.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: userToken.refresh_token
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
                    }
                }
            );

            // Update stored token
            userToken.access_token = response.data.access_token;
            userToken.expires_at = Date.now() + (response.data.expires_in * 1000);

            if (response.data.refresh_token) {
                userToken.refresh_token = response.data.refresh_token;
            }
        } catch (error) {
            console.error('Error refreshing token:', error);
            return res.status(500).json({error: 'Failed to refresh token'});
        }
    }

    // Return the valid access token
    res.json({access_token: userToken.access_token});
});

// Fallback for client credentials flow (for search functionality only)
app.get('/spotify-search-token', async (req, res) => {
    try {
        const response = await axios.post(
            'https://accounts.spotify.com/api/token',
            'grant_type=client_credentials',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
                }
            }
        );
        res.json({access_token: response.data.access_token});
    } catch (err) {
        res.status(500).json({error: 'Failed to get Spotify token', details: err.message});
    }
});

// Helper function to generate a random string
function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Clean up pending requests older than 10 minutes
function cleanupPendingRequests() {
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);

    Object.keys(pendingRequests).forEach(state => {
        if (pendingRequests[state].timestamp < tenMinutesAgo) {
            delete pendingRequests[state];
        }
    });
}

app.listen(PORT, () => {
    console.log(`Spotify token server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT}/ to start the authentication process`);
    console.log(`IMPORTANT: Make sure your Spotify app has ${REDIRECT_URI} registered as a redirect URI`);
});
