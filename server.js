// server.js - Complete backend with OAuth for Shopify
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'mummamitra.myshopify.com';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback';
const SCOPES = 'read_orders,read_products,read_customers,write_orders';
const API_VERSION = '2024-01';

let accessToken = process.env.SHOPIFY_ACCESS_TOKEN || null;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`
    <h1>Shopify Analytics Backend</h1>
    <p>Status: ${accessToken ? 'Connected' : 'Not Connected'}</p>
    <p><a href="/auth/shopify">Connect to Shopify</a></p>
  `);
});

app.get('/auth/shopify', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = `https://${SHOPIFY_STORE}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${REDIRECT_URI}&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');
  
  try {
    const tokenResponse = await axios.post(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code: code
    });
    accessToken = tokenResponse.data.access_token;
    res.send(`<h1>Success!</h1><p>Token: ${accessToken}</p><p>Save this as SHOPIFY_ACCESS_TOKEN env variable</p>`);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

const shopifyRequest = async (endpoint) => {
  if (!accessToken) throw new Error('Not authenticated');
  const response = await axios.get(`https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/${endpoint}`, {
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' }
  });
  return response.data;
};

app.get('/api/orders', async (req, res) => {
  try {
    const data = await shopifyRequest('orders.json?limit=250&status=any');
    res.json({ success: true, orders: data.orders, count: data.orders.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const data = await shopifyRequest('products.json?limit=250');
    res.json({ success: true, products: data.products, count: data.products.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const { date = 'today' } = req.query;
    
    const data = await shopifyRequest('orders.json?limit=250&status=any');
    
    // Get target date in YYYY-MM-DD format for IST
    const now = new Date();
    const todayIST = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    const yesterdayDate = new Date(now.getTime() - 86400000);
    const yesterdayIST = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    const targetDate = date === 'today' ? todayIST : yesterdayIST;
    
    // Filter orders by IST date
    const filteredOrders = data.orders.filter(order => {
      const orderDateIST = new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return orderDateIST === targetDate;
    });
    
    const analytics = processOrders(filteredOrders);
    
    res.json({
      success: true,
      date,
      targetDate,
      analytics
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function processOrders(orders) {
  const skuData = {};
  
  orders.forEach(order => {
    const isCOD = order.payment_gateway_names?.some(gw => 
      gw.toLowerCase().includes('cod') || gw.toLowerCase().includes('cash on delivery')
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
  
  return { totalOrders: orders.length, skus: Object.values(skuData) };
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
