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
  res.send('<h1>Shopify Backend</h1><p>Status: ' + (accessToken ? 'Connected' : 'Not Connected') + '</p>');
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

app.get('/api/orders', async (req, res) => {
  try {
    const data = await shopifyRequest('orders.json?limit=250&status=any');
    res.json({ success: true, orders: data.orders, count: data.orders.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const { date = 'today' } = req.query;
    const data = await shopifyRequest('orders.json?limit=250&status=any');
    
    const now = new Date();
    const todayIST = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const yesterdayDate = new Date(now.getTime() - 86400000);
    const yesterdayIST = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const targetDate = date === 'today' ? todayIST : yesterdayIST;
    
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
  let codCount = 0;
  let prepaidCount = 0;
  let codRevenue = 0;
  let prepaidRevenue = 0;
  const seenOrders = new Set();
  
  orders.forEach(order => {
    const isCOD = order.payment_gateway_names?.some(gw => 
      gw.toLowerCase().includes('cod') || gw.toLowerCase().includes('cash on delivery')
    );
    
    const orderTotal = parseFloat(order.total_price || 0);
    
    if (!seenOrders.has(order.id)) {
      seenOrders.add(order.id);
      if (isCOD) {
        codCount++;
        codRevenue += orderTotal;
      } else {
        prepaidCount++;
        prepaidRevenue += orderTotal;
      }
    }
    
    // For SKU breakdown, distribute order total proportionally
    const itemsTotal = order.line_items?.reduce((sum, item) => 
      sum + (parseFloat(item.price) * item.quantity), 0) || 1;
    
    order.line_items?.forEach(item => {
      const sku = item.sku || item.variant_id || 'unknown';
      
      if (!skuData[sku]) {
        skuData[sku] = {
          sku,
          productName: item.name,
          codRevenue: 0,
          prepaidRevenue: 0,
          totalRevenue: 0
        };
      }
      
      // Proportional revenue for this SKU
      const itemSubtotal = parseFloat(item.price) * item.quantity;
      const proportion = itemSubtotal / itemsTotal;
      const skuRevenue = orderTotal * proportion;
      
      if (isCOD) {
        skuData[sku].codRevenue += skuRevenue;
      } else {
        skuData[sku].prepaidRevenue += skuRevenue;
      }
      
      skuData[sku].totalRevenue += skuRevenue;
    });
  });
  
  return { 
    totalOrders: orders.length,
    totalCODOrders: codCount,
    totalPrepaidOrders: prepaidCount,
    totalRevenue: codRevenue + prepaidRevenue,
    skus: Object.values(skuData) 
  };
}

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
