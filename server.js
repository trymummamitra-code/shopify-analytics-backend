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

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;

const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;

let accessToken = process.env.SHOPIFY_ACCESS_TOKEN || null;
let shiprocketToken = null;
let shiprocketTokenExpiry = null;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('<h1>Backend Running</h1>');
});

app.get('/auth/shopify', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = `https://${SHOPIFY_STORE}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${REDIRECT_URI}&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code');
  
  try {
    const response = await axios.post(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code: code
    });
    accessToken = response.data.access_token;
    res.send('<h1>Success!</h1><p>Token: ' + accessToken + '</p>');
  } catch (error) {
    res.status(500).send('Error: ' + error.message);
  }
});

const shopifyRequest = async (endpoint) => {
  if (!accessToken) throw new Error('Not authenticated');
  const response = await axios.get(`https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/${endpoint}`, {
    headers: { 'X-Shopify-Access-Token': accessToken }
  });
  return response.data;
};

const getShiprocketToken = async () => {
  if (shiprocketToken && shiprocketTokenExpiry && Date.now() < shiprocketTokenExpiry) {
    return shiprocketToken;
  }
  
  if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) {
    return null;
  }
  
  try {
    const response = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', {
      email: SHIPROCKET_EMAIL,
      password: SHIPROCKET_PASSWORD
    });
    
    shiprocketToken = response.data.token;
    shiprocketTokenExpiry = Date.now() + (10 * 24 * 60 * 60 * 1000);
    console.log('✓ Shiprocket authenticated');
    
    return shiprocketToken;
  } catch (error) {
    console.error('Shiprocket auth error:', error.response?.data || error.message);
    return null;
  }
};

app.get('/api/debug/shiprocket-dates', async (req, res) => {
  const token = await getShiprocketToken();
  if (!token) return res.json({ error: 'No token' });
  
  try {
    const today = new Date();
    const date14DaysAgo = new Date(today.getTime() - 14 * 86400000);
    const date7DaysAgo = new Date(today.getTime() - 7 * 86400000);
    
    const startDate = date14DaysAgo.toISOString().split('T')[0];
    const endDate = date7DaysAgo.toISOString().split('T')[0];
    
    const tests = [];
    
    try {
      const test1 = await axios.get('https://apiv2.shiprocket.in/v1/external/orders', {
        headers: { 'Authorization': `Bearer ${token}` },
        params: { 
          per_page: 50,
          filter_by_date: '1',
          from_date: startDate,
          to_date: endDate
        }
      });
      tests.push({ name: 'filter_by_date', success: true, count: test1.data.data.length });
    } catch (e) {
      tests.push({ name: 'filter_by_date', success: false, error: e.response?.data?.message || e.message });
    }
    
    try {
      const test2 = await axios.get('https://apiv2.shiprocket.in/v1/external/orders', {
        headers: { 'Authorization': `Bearer ${token}` },
        params: { 
          per_page: 50,
          created_from: startDate,
          created_to: endDate
        }
      });
      tests.push({ name: 'created_from/to', success: true, count: test2.data.data.length });
    } catch (e) {
      tests.push({ name: 'created_from/to', success: false, error: e.response?.data?.message || e.message });
    }
    
    try {
      const test3 = await axios.get('https://apiv2.shiprocket.in/v1/external/orders', {
        headers: { 'Authorization': `Bearer ${token}` },
        params: { 
          per_page: 50,
          pickup_from: startDate,
          pickup_to: endDate
        }
      });
      tests.push({ name: 'pickup_from/to', success: true, count: test3.data.data.length });
    } catch (e) {
      tests.push({ name: 'pickup_from/to', success: false, error: e.response?.data?.message || e.message });
    }
    
    res.json({
      dateRange: `${startDate} to ${endDate}`,
      tests
    });
    
  } catch (error) {
    res.json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
