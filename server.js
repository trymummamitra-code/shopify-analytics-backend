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

const fetchMetaAdSpend = async (startDate, endDate) => {
  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
    return {};
  }
  
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v21.0/act_${META_AD_ACCOUNT_ID}/campaigns`,
      {
        params: {
          access_token: META_ACCESS_TOKEN,
          fields: 'name,insights.date_preset(maximum).time_range({"since":"' + startDate + '","until":"' + endDate + '"}){spend,campaign_name}',
          limit: 500
        }
      }
    );
    
    const campaigns = response.data.data || [];
    const adSpendByProduct = {};
    
    campaigns.forEach(campaign => {
      if (campaign.insights && campaign.insights.data && campaign.insights.data.length > 0) {
        const spend = parseFloat(campaign.insights.data[0].spend || 0);
        const campaignName = campaign.name;
        
        const productName = campaignName.split('|')[0].trim().toLowerCase();
        
        if (!adSpendByProduct[productName]) {
          adSpendByProduct[productName] = 0;
        }
        adSpendByProduct[productName] += spend;
      }
    });
    
    return adSpendByProduct;
  } catch (error) {
    console.error('Meta API error:', error.response?.data || error.message);
    return {};
  }
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
    
    const adSpendByProduct = await fetchMetaAdSpend(targetDate, targetDate);
    
    const analytics = processOrders(filteredOrders, adSpendByProduct);
    
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

function processOrders(orders, adSpendByProduct) {
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
          totalRevenue: 0,
          codOrders: 0,
          prepaidOrders: 0,
          codOrderIds: new Set(),
          prepaidOrderIds: new Set(),
          adSpend: 0
        };
      }
      
      if (isCOD && !skuData[sku].codOrderIds.has(order.id)) {
        skuData[sku].codOrderIds.add(order.id);
        skuData[sku].codOrders++;
      } else if (!isCOD && !skuData[sku].prepaidOrderIds.has(order.id)) {
        skuData[sku].prepaidOrderIds.add(order.id);
        skuData[sku].prepaidOrders++;
      }
      
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
  
  const skus = Object.values(skuData).map(sku => {
    const productNameLower = sku.productName.toLowerCase();
    
    // Match campaign names that are prefixes of product names
    let adSpend = 0;
    for (const [campaignName, spend] of Object.entries(adSpendByProduct)) {
      if (productNameLower.startsWith(campaignName.toLowerCase())) {
        adSpend += spend;
      }
    }
    
    return {
      sku: sku.sku,
      productName: sku.productName,
      codRevenue: sku.codRevenue,
      prepaidRevenue: sku.prepaidRevenue,
      totalRevenue: sku.totalRevenue,
      codOrders: sku.codOrders,
      prepaidOrders: sku.prepaidOrders,
      adSpend: adSpend
    };
  });
  
  return { 
    totalOrders: orders.length,
    totalCODOrders: codCount,
    totalPrepaidOrders: prepaidCount,
    totalRevenue: codRevenue + prepaidRevenue,
    skus
  };
}

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
