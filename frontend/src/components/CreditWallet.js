import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import { Wallet, CreditCard, ArrowUpRight, ArrowDownLeft, History, Plus, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const CreditWallet = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState(25);
  const [purchasing, setPurchasing] = useState(false);

  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';

  const creditPackages = [
    { amount: 10, bonus: 0, label: '$10' },
    { amount: 25, bonus: 0, label: '$25' },
    { amount: 50, bonus: 5, label: '$50', popular: true },
    { amount: 100, bonus: 15, label: '$100', bestValue: true },
  ];

  useEffect(() => {
    // Check for payment success/cancel
    const sessionId = searchParams.get('session_id');
    if (sessionId) {
      verifyPayment(sessionId);
    } else {
      fetchWalletData();
    }
  }, [user?.id]);

  const fetchWalletData = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // Fetch balance
      const balanceRes = await axios.get(`${API}/credits/balance/${user.id}`);
      setBalance(balanceRes.data.balance || 0);

      // Fetch transaction history
      try {
        const historyRes = await axios.get(`${API}/credits/history/${user.id}?limit=20`);
        setTransactions(historyRes.data.transactions || []);
      } catch (e) {
        setTransactions([]);
      }

      // Fetch summary
      try {
        const summaryRes = await axios.get(`${API}/credits/summary/${user.id}`);
        setSummary(summaryRes.data);
      } catch (e) {
        setSummary(null);
      }
    } catch (error) {
      logger.error('Error fetching wallet data:', error);
    } finally {
      setLoading(false);
    }
  };

  const verifyPayment = async (sessionId) => {
    try {
      const res = await axios.get(`${API}/credits/status/${sessionId}`);
      if (res.data.payment_status === 'paid') {
        toast.success(`Successfully added ${res.data.amount} credits!`);
      }
      // Clear URL params
      navigate('/wallet', { replace: true });
      fetchWalletData();
    } catch (error) {
      toast.error('Failed to verify payment');
      navigate('/wallet', { replace: true });
      fetchWalletData();
    }
  };

  const handleBuyCredits = async () => {
    if (!user?.id) return;
    setPurchasing(true);
    try {
      const res = await axios.post(`${API}/credits/purchase?user_id=${user.id}`, {
        amount: selectedAmount,
        origin_url: window.location.origin
      });
      if (res.data.checkout_url) {
        window.location.href = res.data.checkout_url;
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to start purchase');
      setPurchasing(false);
    }
  };

  const getTransactionIcon = (type) => {
    if (type.includes('earning') || type.includes('sale') || type === 'stripe_topup' || type === 'refund') {
      return <ArrowDownLeft className="w-4 h-4 text-green-400" />;
    }
    return <ArrowUpRight className="w-4 h-4 text-red-400" />;
  };

  const getTransactionLabel = (type) => {
    const labels = {
      'stripe_topup': 'Credit Purchase',
      'live_session_buyin': 'Live Session Buy-in',
      'live_session_earning': 'Session Earning',
      'live_photo_purchase': 'Photo Purchase',
      'booking_payment': 'Booking Payment',
      'booking_earning': 'Booking Earning',
      'gallery_purchase': 'Gallery Purchase',
      'gallery_sale': 'Gallery Sale',
      'refund': 'Refund'
    };
    return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400"></div>
      </div>
    );
  }

  return (
    <div className={`pb-20 min-h-screen ${mainBgClass} transition-colors duration-300`} data-testid="credit-wallet-page">
      <div className="max-w-lg mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className={`text-3xl font-bold ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }}>
            Credit Wallet
          </h1>
          <Button
            onClick={fetchWalletData}
            variant="ghost"
            size="icon"
            className={textSecondaryClass}
          >
            <RefreshCw className="w-5 h-5" />
          </Button>
        </div>

        {/* Balance Card */}
        <Card className="mb-6 bg-gradient-to-br from-green-500/20 via-emerald-500/20 to-teal-500/20 border-green-500/30">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className={textSecondaryClass}>Available Balance</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className={`text-4xl font-bold ${textPrimaryClass}`}>
                    ${balance.toFixed(2)}
                  </span>
                  <span className={`text-sm ${textSecondaryClass}`}>credits</span>
                </div>
                <p className={`text-xs ${textSecondaryClass} mt-2`}>1 credit = $1 USD</p>
              </div>
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <Wallet className="w-8 h-8 text-green-400" />
              </div>
            </div>
            <Button
              onClick={() => setShowBuyModal(true)}
              className="w-full mt-4 bg-gradient-to-r from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 text-black font-medium"
              data-testid="add-credits-btn"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Credits
            </Button>
          </CardContent>
        </Card>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <Card className={cardBgClass}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                  <span className={`text-sm ${textSecondaryClass}`}>Total Earned</span>
                </div>
                <p className={`text-xl font-bold ${textPrimaryClass} mt-1`}>
                  ${(summary.total_earned || 0).toFixed(2)}
                </p>
              </CardContent>
            </Card>
            <Card className={cardBgClass}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-orange-400" />
                  <span className={`text-sm ${textSecondaryClass}`}>Total Spent</span>
                </div>
                <p className={`text-xl font-bold ${textPrimaryClass} mt-1`}>
                  ${(summary.total_spent || 0).toFixed(2)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Transaction History */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <History className={`w-5 h-5 ${textSecondaryClass}`} />
            <h2 className={`text-lg font-bold ${textPrimaryClass}`}>Recent Activity</h2>
          </div>

          {transactions.length === 0 ? (
            <Card className={cardBgClass}>
              <CardContent className="py-12 text-center">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
                  <History className={`w-8 h-8 ${textSecondaryClass}`} />
                </div>
                <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Transactions Yet</h3>
                <p className={textSecondaryClass}>
                  Your credit activity will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <Card key={tx.id} className={cardBgClass}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
                          {getTransactionIcon(tx.transaction_type)}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${textPrimaryClass}`}>
                            {getTransactionLabel(tx.transaction_type)}
                          </p>
                          <p className={`text-xs ${textSecondaryClass}`}>
                            {new Date(tx.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                        </p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          Balance: ${tx.balance_after.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {tx.description && (
                      <p className={`text-xs ${textSecondaryClass} mt-2 ml-13`}>
                        {tx.description}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Buy Credits Modal */}
      <Dialog open={showBuyModal} onOpenChange={setShowBuyModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Add Credits</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className={`text-sm ${textSecondaryClass} mb-4`}>
              Select a credit package. 1 credit = $1 USD.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {creditPackages.map((pkg) => (
                <button
                  key={pkg.amount}
                  onClick={() => setSelectedAmount(pkg.amount)}
                  className={`p-4 rounded-lg border-2 transition-all relative ${
                    selectedAmount === pkg.amount
                      ? 'border-green-400 bg-green-400/10'
                      : `${borderClass} ${isLight ? 'bg-white hover:bg-gray-50' : 'bg-zinc-800/50 hover:bg-zinc-800'}`
                  }`}
                >
                  {pkg.popular && (
                    <Badge className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs">
                      Popular
                    </Badge>
                  )}
                  {pkg.bestValue && (
                    <Badge className="absolute -top-2 -right-2 bg-green-500 text-white text-xs">
                      Best Value
                    </Badge>
                  )}
                  <p className={`text-2xl font-bold ${selectedAmount === pkg.amount ? 'text-green-400' : textPrimaryClass}`}>
                    {pkg.label}
                  </p>
                  <p className={`text-sm ${textSecondaryClass}`}>
                    {pkg.amount} credits
                  </p>
                  {pkg.bonus > 0 && (
                    <p className="text-xs text-green-400 mt-1">
                      +{pkg.bonus} bonus credits
                    </p>
                  )}
                </button>
              ))}
            </div>
            
            <div className={`mt-4 p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <div className="flex justify-between items-center">
                <span className={textSecondaryClass}>You pay:</span>
                <span className={`text-xl font-bold ${textPrimaryClass}`}>${selectedAmount}</span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className={textSecondaryClass}>You get:</span>
                <span className="text-xl font-bold text-green-400">
                  {selectedAmount + (creditPackages.find(p => p.amount === selectedAmount)?.bonus || 0)} credits
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBuyModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleBuyCredits}
              disabled={purchasing}
              className="bg-gradient-to-r from-green-400 to-emerald-500 text-black"
            >
              {purchasing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4 mr-2" />
                  Pay ${selectedAmount}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
