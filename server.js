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

const fetchShiprocketOrders = async () => {
  const token = await getShiprocketToken();
  if (!token) return {};
  
  try {
    const response = await axios.get('https://apiv2.shiprocket.in/v1/external/orders', {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { per_page: 250 }
    });
    
    const orders = response.data.data || [];
    const orderStatusMap = {};
    
    orders.forEach(order => {
      const orderNumber = order.channel_order_id;
      const status = String(order.status || '').toLowerCase();
      const shipmentStatus = String(order.shipments?.[0]?.status || '').toLowerCase();
      const pickupDate = order.pickup_scheduled_date || order.shipments?.[0]?.pickup_scheduled_date;
      
      let deliveryStatus = 'pending';
      
      if (status === 'cancelled' || status === 'canceled') {
        deliveryStatus = 'cancelled';
      } else if (
        shipmentStatus.includes('rto initiated') || 
        shipmentStatus.includes('rto in transit') ||
        shipmentStatus.includes('rto ndr') ||
        shipmentStatus.includes('rto ofd') ||
        shipmentStatus.includes('rto delivered') ||
        shipmentStatus.includes('rto acknowledged') ||
        shipmentStatus.includes('rto lock') ||
        shipmentStatus.includes('rto requested') ||
        shipmentStatus.includes('rto') ||
        status.includes('rto')
      ) {
        deliveryStatus = 'rto';
      } else if (shipmentStatus.includes('delivered')) {
        deliveryStatus = 'delivered';
      } else if (shipmentStatus.includes('transit') || shipmentStatus.includes('shipped')) {
        deliveryStatus = 'in_transit';
      }
      
      orderStatusMap[orderNumber] = {
        status: deliveryStatus,
        pickupDate: pickupDate
      };
    });
    
    console.log(`✓ Fetched ${orders.length} Shiprocket orders`);
    return orderStatusMap;
  } catch (error) {
    console.error('Shiprocket orders error:', error.response?.data || error.message);
    return {};
  }
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

const extractProductFromUTM = (landingPageUrl) => {
  if (!landingPageUrl) return null;
  
  try {
    const url = new URL(landingPageUrl);
    const utmCampaign = url.searchParams.get('utm_campaign');
    
    if (utmCampaign) {
      const productName = utmCampaign.split('_')[0].trim().toLowerCase();
      return productName;
    }
  } catch (e) {
    return null;
  }
  
  return null;
};

app.get('/api/analytics', async (req, res) => {
  try {
    const { date = 'today' } = req.query;
    
    const now = new Date();
    const todayIST = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const yesterdayDate = new Date(now.getTime() - 86400000);
    const yesterdayIST = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const targetDate = date === 'today' ? todayIST : yesterdayIST;
    
    // Fetch last 14 days for historical analysis
    const data = await shopifyRequest('orders.json?limit=250&status=any');
    
    const filteredOrders = data.orders.filter(order => {
      const orderDateIST = new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return orderDateIST === targetDate;
    });
    
    const [adSpendByProduct, shiprocketStatuses] = await Promise.all([
      fetchMetaAdSpend(targetDate, targetDate),
      fetchShiprocketOrders()
    ]);
    
    // Calculate predictive rates from historical data
    const targetDateObj = new Date(targetDate);
    const predictiveRates = calculatePredictiveRates(data.orders, shiprocketStatuses, targetDateObj);
    
    const analytics = processOrders(filteredOrders, adSpendByProduct, shiprocketStatuses, predictiveRates);
    
    res.json({ success: true, date, targetDate, analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function calculatePredictiveRates(allOrders, shiprocketStatuses, targetDate) {
  const productRates = {};
  
  // RTO: 14-7 days before target (pickup date range)
  const rtoEndDate = new Date(targetDate.getTime() - 7 * 86400000);
  const rtoStartDate = new Date(targetDate.getTime() - 14 * 86400000);
  
  // Cancellation: 7-1 days before target (created date range)
  const cancelEndDate = new Date(targetDate.getTime() - 1 * 86400000);
  const cancelStartDate = new Date(targetDate.getTime() - 7 * 86400000);
  
  allOrders.forEach(order => {
    const orderCreatedIST = new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const orderCreatedDate = new Date(orderCreatedIST);
    const orderNumber = order.name?.replace('#', '') || order.order_number;
    const shiprocketData = shiprocketStatuses[orderNumber];
    
    const isCOD = order.payment_gateway_names?.some(gw => 
      gw.toLowerCase().includes('cod') || gw.toLowerCase().includes('cash on delivery')
    );
    
    // Get attributed product
    const landingPageUrl = order.landing_site;
    const utmProduct = extractProductFromUTM(landingPageUrl);
    let attributedProduct = null;
    
    if (utmProduct) {
      attributedProduct = utmProduct;
    } else {
      const lineItems = order.line_items || [];
      if (lineItems.length === 1) {
        const productName = lineItems[0].name.toLowerCase();
        attributedProduct = productName.split('™')[0].split('–')[0].trim();
      } else if (lineItems.length > 1) {
        const revenueMap = {};
        lineItems.forEach(item => {
          const productName = item.name.toLowerCase();
          const productKey = productName.split('™')[0].split('–')[0].trim();
          const itemRevenue = parseFloat(item.price) * item.quantity;
          revenueMap[productKey] = (revenueMap[productKey] || 0) + itemRevenue;
        });
        const sorted = Object.entries(revenueMap).sort((a, b) => b[1] - a[1]);
        if (sorted[0][1] / Object.values(revenueMap).reduce((a,b) => a+b, 0) > 0.5) {
          attributedProduct = sorted[0][0];
        }
      }
    }
    
    if (!attributedProduct) return;
    
    if (!productRates[attributedProduct]) {
      productRates[attributedProduct] = {
        rtoTotal: 0,
        rtoNotDelivered: 0,
        cancelTotal: 0,
        cancelCancelled: 0
      };
    }
    
    // RTO calculation (only COD, pickup date 14-7 days ago)
    if (isCOD && shiprocketData?.pickupDate) {
      const pickupDateIST = new Date(shiprocketData.pickupDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const pickupDate = new Date(pickupDateIST);
      
      if (pickupDate >= rtoStartDate && pickupDate <= rtoEndDate) {
        productRates[attributedProduct].rtoTotal++;
        if (shiprocketData.status !== 'delivered') {
          productRates[attributedProduct].rtoNotDelivered++;
        }
      }
    }
    
    // Cancellation calculation (all orders, created 7-1 days ago)
    if (orderCreatedDate >= cancelStartDate && orderCreatedDate <= cancelEndDate) {
      productRates[attributedProduct].cancelTotal++;
      if (shiprocketData?.status === 'cancelled') {
        productRates[attributedProduct].cancelCancelled++;
      }
    }
  });
  
  // Calculate percentages
  const rates = {};
  for (const [product, data] of Object.entries(productRates)) {
    rates[product] = {
      predictiveRTO: data.rtoTotal > 0 ? (data.rtoNotDelivered / data.rtoTotal * 100) : 0,
      predictiveCancel: data.cancelTotal > 0 ? (data.cancelCancelled / data.cancelTotal * 100) : 0
    };
  }
  
  return rates;
}

function processOrders(orders, adSpendByProduct, shiprocketStatuses, predictiveRates) {
  const skuData = {};
  const productAttributionMap = {};
  let codCount = 0;
  let prepaidCount = 0;
  let codRevenue = 0;
  let prepaidRevenue = 0;
  const seenOrders = new Set();
  let manualReviewCount = 0;
  
  orders.forEach(order => {
    const isCOD = order.payment_gateway_names?.some(gw => 
      gw.toLowerCase().includes('cod') || gw.toLowerCase().includes('cash on delivery')
    );
    
    const orderTotal = parseFloat(order.total_price || 0);
    const orderNumber = order.name?.replace('#', '') || order.order_number;
    const shiprocketData = shiprocketStatuses[orderNumber];
    const shiprocketStatus = shiprocketData?.status || 'unknown';
    
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
    
    // Attribution logic
    let attributedProduct = null;
    const landingPageUrl = order.landing_site;
    const utmProduct = extractProductFromUTM(landingPageUrl);
    
    if (utmProduct) {
      attributedProduct = utmProduct;
    } else {
      const lineItems = order.line_items || [];
      
      if (lineItems.length === 1) {
        const productName = lineItems[0].name.toLowerCase();
        const productKey = productName.split('™')[0].split('–')[0].trim();
        attributedProduct = productKey;
      } else if (lineItems.length > 1) {
        const revenueMap = {};
        lineItems.forEach(item => {
          const productName = item.name.toLowerCase();
          const productKey = productName.split('™')[0].split('–')[0].trim();
          const itemRevenue = parseFloat(item.price) * item.quantity;
          revenueMap[productKey] = (revenueMap[productKey] || 0) + itemRevenue;
        });
        
        const sorted = Object.entries(revenueMap).sort((a, b) => b[1] - a[1]);
        const topProduct = sorted[0];
        const topRevenue = topProduct[1];
        const totalRevenue = Object.values(revenueMap).reduce((a, b) => a + b, 0);
        
        if (topRevenue / totalRevenue > 0.5) {
          attributedProduct = topProduct[0];
        } else {
          manualReviewCount++;
        }
      }
    }
    
    if (attributedProduct) {
      if (!productAttributionMap[attributedProduct]) {
        productAttributionMap[attributedProduct] = { orders: 0, codOrders: 0 };
      }
      productAttributionMap[attributedProduct].orders++;
      if (isCOD) productAttributionMap[attributedProduct].codOrders++;
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
          deliveredOrders: 0,
          rtoOrders: 0,
          cancelledOrders: 0,
          inTransitOrders: 0
        };
      }
      
      if (isCOD && !skuData[sku].codOrderIds.has(order.id)) {
        skuData[sku].codOrderIds.add(order.id);
        skuData[sku].codOrders++;
        
        if (shiprocketStatus === 'delivered') skuData[sku].deliveredOrders++;
        else if (shiprocketStatus === 'rto') skuData[sku].rtoOrders++;
        else if (shiprocketStatus === 'cancelled') skuData[sku].cancelledOrders++;
        else if (shiprocketStatus === 'in_transit') skuData[sku].inTransitOrders++;
        
      } else if (!isCOD && !skuData[sku].prepaidOrderIds.has(order.id)) {
        skuData[sku].prepaidOrderIds.add(order.id);
        skuData[sku].prepaidOrders++;
        
        if (shiprocketStatus === 'delivered') skuData[sku].deliveredOrders++;
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
    const productKey = productNameLower.split('™')[0].split('–')[0].trim();
    
    let adSpend = 0;
    for (const [campaignName, spend] of Object.entries(adSpendByProduct)) {
      if (productKey.startsWith(campaignName)) {
        adSpend += spend;
      }
    }
    
    const attribution = productAttributionMap[productKey] || { orders: 0 };
    const attributedOrders = attribution.orders;
    const cac = attributedOrders > 0 ? adSpend / attributedOrders : 0;
    
    const totalOrders = sku.codOrders + sku.prepaidOrders;
    const rates = predictiveRates[productKey] || { predictiveRTO: 0, predictiveCancel: 0 };
    
    return {
      sku: sku.sku,
      productName: sku.productName,
      codRevenue: sku.codRevenue,
      prepaidRevenue: sku.prepaidRevenue,
      totalRevenue: sku.totalRevenue,
      codOrders: sku.codOrders,
      prepaidOrders: sku.prepaidOrders,
      totalOrders: totalOrders,
      adSpend: adSpend,
      attributedOrders: attributedOrders,
      cac: cac,
      deliveredOrders: sku.deliveredOrders,
      rtoOrders: sku.rtoOrders,
      cancelledOrders: sku.cancelledOrders,
      inTransitOrders: sku.inTransitOrders,
      predictiveRTO: rates.predictiveRTO,
      predictiveCancel: rates.predictiveCancel
    };
  });
  
  return { 
    totalOrders: orders.length,
    totalCODOrders: codCount,
    totalPrepaidOrders: prepaidCount,
    totalRevenue: codRevenue + prepaidRevenue,
    manualReviewCount: manualReviewCount,
    skus
  };
}

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
