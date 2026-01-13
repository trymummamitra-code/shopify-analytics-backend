<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shopify Analytics</title>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
    <div id="root"></div>
    
    <script type="text/babel">
        const { useState, useEffect } = React;
        
        function Dashboard() {
            const [dateRange, setDateRange] = useState('yesterday');
            const [isDark, setIsDark] = useState(true);
            const [loading, setLoading] = useState(true);
            const [data, setData] = useState(null);
            const [error, setError] = useState(null);
            
            useEffect(() => {
                fetchData();
            }, [dateRange]);
            
            const fetchData = async () => {
                setLoading(true);
                setError(null);
                
                try {
                    const response = await fetch(`https://shopify-analytics-backend-476y.onrender.com/api/analytics?date=${dateRange}&t=${Date.now()}`);
                    const result = await response.json();
                    
                    if (result.success) {
                        setData(result);
                    } else {
                        setError(result.error);
                    }
                } catch (err) {
                    setError(err.message);
                } finally {
                    setLoading(false);
                }
            };
            
            if (loading) {
                return (
                    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                        <div className="text-white">Loading...</div>
                    </div>
                );
            }
            
            if (error) {
                return (
                    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                        <div className="text-red-400">Error: {error}</div>
                    </div>
                );
            }
            
            const totalRevenue = data.analytics.totalRevenue || 0;
            const totalCOD = data.analytics.totalCODOrders || 0;
            const totalPrepaid = data.analytics.totalPrepaidOrders || 0;
            const totalOrders = data.analytics.totalOrders || 1;
            
            return (
                <div className={isDark ? 'bg-slate-900 min-h-screen' : 'bg-slate-50 min-h-screen'}>
                    <div className="max-w-7xl mx-auto p-6 space-y-6">
                        
                        <div className="flex justify-between items-center">
                            <div>
                                <h1 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                    Shopify Analytics
                                </h1>
                                <p className={`text-sm mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                                    Date: {data.targetDate} • Orders: {totalOrders}
                                </p>
                            </div>
                            
                            <div className="flex gap-3">
                                <button onClick={() => setIsDark(!isDark)} className="px-4 py-2 rounded bg-slate-800 text-white">
                                    {isDark ? '☀️' : '🌙'}
                                </button>
                                <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} 
                                    className="px-4 py-2 rounded bg-slate-800 text-white">
                                    <option value="today">Today</option>
                                    <option value="yesterday">Yesterday</option>
                                </select>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4">
                            <div className="bg-blue-600 rounded-xl p-4 text-white">
                                <div className="text-sm mb-1">Total Orders</div>
                                <div className="text-3xl font-bold">{totalOrders}</div>
                            </div>
                            <div className="bg-green-600 rounded-xl p-4 text-white">
                                <div className="text-sm mb-1">Revenue</div>
                                <div className="text-3xl font-bold">₹{Math.round(totalRevenue)}</div>
                            </div>
                            <div className="bg-purple-600 rounded-xl p-4 text-white">
                                <div className="text-sm mb-1">COD</div>
                                <div className="text-3xl font-bold">{totalCOD}</div>
                            </div>
                            <div className="bg-orange-600 rounded-xl p-4 text-white">
                                <div className="text-sm mb-1">Prepaid</div>
                                <div className="text-3xl font-bold">{totalPrepaid}</div>
                            </div>
                        </div>
                        
                        <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
                            <table className="w-full">
                                <thead className="bg-slate-900">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Product</th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Revenue</th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">COD</th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Prepaid</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700">
                                    {data.analytics.skus.map((sku, i) => (
                                        <tr key={i} className="hover:bg-slate-700/50">
                                            <td className="px-6 py-4">
                                                <div className="text-white font-medium">{sku.productName}</div>
                                                <div className="text-sm text-slate-400">{sku.sku}</div>
                                            </td>
                                            <td className="px-6 py-4 text-green-400 font-medium">₹{Math.round(sku.totalRevenue)}</td>
                                            <td className="px-6 py-4 text-slate-300">
                                                {sku.codOrders > 0 ? `${sku.codOrders} (${Math.round(sku.codOrders/totalOrders*100)}%)` : '-'}
                                            </td>
                                            <td className="px-6 py-4 text-slate-300">
                                                {sku.prepaidOrders > 0 ? `${sku.prepaidOrders} (${Math.round(sku.prepaidOrders/totalOrders*100)}%)` : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            );
        }
        
        ReactDOM.render(<Dashboard />, document.getElementById('root'));
    </script>
</body>
</html>
