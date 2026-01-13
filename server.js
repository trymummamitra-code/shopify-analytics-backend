// server.js - Complete backend with OAuth for Shopify
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from environment variables
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'mummamitra.myshopify.com';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback';
const SCOPES = 'read_orders,read_products,read_customers,write_orders';
const API_VERSION = '2024-01';

// In-memory token storage (use database in production)
let accessToken = process.env.SHOPIFY_ACCESS_TOKEN || null;

app.use(cors());
app.use(express.json());

// Home page with OAuth instructions
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Shopify Analytics Backend</title>
      <style>
        body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
        .status { padding: 20px; border-radius: 8px; margin: 20px 0; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; }
        .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        .btn { 
          display: inline-block;
          padding: 12px 24px; 
          background: #5469d4; 
          color: white; 
          text-decoration: none; 
          border-radius: 6px;
          font-weight: bold;
        }
        .btn:hover { background: #4457b8; }
        code { 
          background: #f4f4f4; 
          padding: 2px 6px; 
          border-radius: 3px;
          font-family: monospace;
        }
        .token { 
          background: #f8f9fa; 
          padding: 15px; 
          border-radius: 6px; 
          word-break: break-all;
          margin: 10px 0;
          font-family: monospace;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <h1>Shopify Analytics Backend</h1>
      
      ${accessToken ? `
        <div class="status success">
          <h2>✅ Connected to Shopify!</h2>
          <p>Your store is authenticated and ready to fetch data.</p>
          <div class="token"><strong>Access Token:</strong> ${accessToken.substring(0, 20)}...</div>
        </div>
        <h3>Available Endpoints:</h3>
        <ul>
          <li><code>GET /api/orders</code> - Fetch orders</li>
          <li><code>GET /api/products</code> - Fetch products</li>
          <li><code>GET /api/analytics?date=today</code> - Get analytics</li>
        </ul>
      ` : `
        <div class="status warning">
          <h2>⚠️ Not Connected</h2>
          <p>Click the button below to connect your Shopify store.</p>
          <p><a href="/auth/shopify" class="btn">Connect to Shopify</a></p>
        </div>
        <h3>How it works:</h3>
        <ol>
          <li>Click "Connect to Shopify"</li>
          <li>Authorize the app in Shopify</li>
          <li>You'll be redirected back with access granted</li>
          <li>Start fetching your data via API endpoints</li>
        </ol>
      `}
      
      <h3>Configuration:</h3>
      <ul>
        <li>Store: <code>${SHOPIFY_STORE}</code></li>
        <li>Client ID: <code>${SHOPIFY_API_KEY.substring(0, 10)}...</code></li>
        <li>Scopes: <code>${SCOPES}</code></li>
      </ul>
    </body>
    </html>
  `);
});

// Start OAuth flow
app.get('/auth/shopify', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = `https://${SHOPIFY_STORE}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}&` +
    `scope=${SCOPES}&` +
    `redirect_uri=${REDIRECT_URI}&` +
    `state=${state}`;
  
  // Store state in cookie or session (simplified here)
  res.cookie('oauth_state', state);
  res.redirect(authUrl);
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).send('Authorization code not provided');
  }
  
  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      `https://${SHOPIFY_STORE}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code: code
      }
    );
    
    accessToken = tokenResponse.data.access_token;
    
    console.log('✅ Access token obtained:', accessToken.substring(0, 20) + '...');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Success!</title>
        <style>
          body { font-family: Arial; max-width: 600px; margin: 100px auto; text-align: center; }
          .success { 
            padding: 40px; 
            background: #d4edda; 
            border-radius: 12px;
            border: 2px solid #c3e6cb;
          }
          h1 { color: #155724; }
          .token { 
            background: white; 
            padding: 15px; 
            border-radius: 6px; 
            margin: 20px 0;
            word-break: break-all;
            font-family: monospace;
            font-size: 14px;
          }
          .btn { 
            display: inline-block;
            margin-top: 20px;
            padding: 12px 24px; 
            background: #28a745; 
            color: white; 
            text-decoration: none; 
            border-radius: 6px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>🎉 Successfully Connected!</h1>
          <p>Your Shopify store is now connected.</p>
          <div class="token">
            <strong>Access Token:</strong><br>
            ${accessToken}
          </div>
          <p><strong>IMPORTANT:</strong> Save this token as environment variable:<br>
          <code>SHOPIFY_ACCESS_TOKEN</code></p>
          <a href="/" class="btn">Go to Dashboard</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.status(500).send(`Error: ${error.response?.data?.error || error.message}`);
  }
});

// Shopify API helper
const shopifyRequest = async (endpoint) => {
  if (!accessToken) {
    throw new Error('Not authenticated. Please connect to Shopify first.');
  }
  
  const response = await axios.get(
    `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/${endpoint}`,
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    }
  );
  
  return response.data;
};

// API Endpoints
app.get('/api/orders', async (req, res) => {
  try {
    const { limit = 250, status = 'any', created_at_min, created_at_max } = req.query;
    
    let endpoint = `orders.json?limit=${limit}&status=${status}`;
    if (created_at_min) endpoint += `&created_at_min=${created_at_min}`;
    if (created_at_max) endpoint += `&created_at_max=${created_at_max}`;
    
    const data = await shopifyRequest(endpoint);
    
    res.json({
      success: true,
      orders: data.orders,
      count: data.orders.length
    });
  } catch (error) {
    console.error('Error fetching orders:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { limit = 250 } = req.query;
    const data = await shopifyRequest(`products.json?limit=${limit}`);
    
    res.json({
      success: true,
      products: data.products,
      count: data.products.length
    });
  } catch (error) {
    console.error('Error fetching products:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const { date = 'today' } = req.query;
    
    // Force IST calculations
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const nowIST = new Date(now.getTime() + istOffset);
    
    let startDate, endDate;
    
    if (date === 'today') {
      startDate = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate(), 0, 0, 0) - istOffset);
      endDate = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate(), 23, 59, 59) - istOffset);
    } else if (date === 'yesterday') {
      const yesterdayIST = new Date(nowIST);
      yesterdayIST.setUTCDate(yesterdayIST.getUTCDate() - 1);
      startDate = new Date(Date.UTC(yesterdayIST.getUTCFullYear(), yesterdayIST.getUTCMonth(), yesterdayIST.getUTCDate(), 0, 0, 0) - istOffset);
      endDate = new Date(Date.UTC(yesterdayIST.getUTCFullYear(), yesterdayIST.getUTCMonth(), yesterdayIST.getUTCDate(), 23, 59, 59) - istOffset);
    }
    
    const created_at_min = startDate.toISOString();
    const created_at_max = endDate.toISOString();
    
    const data = await shopifyRequest(
      `orders.json?limit=250&status=any&created_at_min=${created_at_min}&created_at_max=${created_at_max}`
    );
    
    const analytics = processOrders(data.orders);
    
    res.json({
      success: true,
      date,
      dateRange: { start: created_at_min, end: created_at_max },
      analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const nowIST = getISTDate(new Date());

if (date === 'today') {
  const todayStart = new Date(nowIST.setHours(0, 0, 0, 0));
  const todayEnd = new Date(nowIST.setHours(23, 59, 59, 999));
  created_at_min = todayStart.toISOString();
  created_at_max = todayEnd.toISOString();
} else if (date === 'yesterday') {
  const yesterday = new Date(nowIST);
  yesterday.setDate(yesterday.getDate() - 1);
  created_at_min = new Date(yesterday.setHours(0, 0, 0, 0)).toISOString();
  created_at_max = new Date(yesterday.setHours(23, 59, 59, 999)).toISOString();
}
    
    const data = await shopifyRequest(
      `orders.json?limit=250&status=any&created_at_min=${created_at_min}&created_at_max=${created_at_max}`
    );
    
    const analytics = processOrders(data.orders);
    
    res.json({
      success: true,
      date,
      analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Process orders for analytics
function processOrders(orders) {
  const skuData = {};
  
  orders.forEach(order => {
    const isCOD = order.payment_gateway_names?.some(gw => 
      gw.toLowerCase().includes('cod') || 
      gw.toLowerCase().includes('cash on delivery')
    );
    
    order.line_items?.forEach(item => {
      const sku = item.sku || item.variant_id || 'unknown';
      
      if (!skuData[sku]) {
        skuData[sku] = {
          sku,
          productName: item.name,
          codOrders: 0,
          prepaidOrders: 0,
          codRevenue: 0,
          prepaidRevenue: 0,
          totalOrders: 0,
          totalRevenue: 0
        };
      }
      
      const itemTotal = parseFloat(item.price) * item.quantity;
      
      if (isCOD) {
        skuData[sku].codOrders += 1;
        skuData[sku].codRevenue += itemTotal;
      } else {
        skuData[sku].prepaidOrders += 1;
        skuData[sku].prepaidRevenue += itemTotal;
      }
      
      skuData[sku].totalOrders += 1;
      skuData[sku].totalRevenue += itemTotal;
    });
  });
  
  return {
    totalOrders: orders.length,
    skus: Object.values(skuData)
  };
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Open http://localhost:${PORT} to get started`);
  console.log(`🏪 Shopify Store: ${SHOPIFY_STORE}`);
  console.log(`🔑 Has Access Token: ${!!accessToken}`);
});
