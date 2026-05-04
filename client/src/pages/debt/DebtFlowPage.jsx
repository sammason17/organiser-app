import { useState, useMemo, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  CreditCard, 
  Calendar, 
  ArrowRight, 
  PoundSterling, 
  Info,
  ChevronDown,
  AlertCircle,
  History,
  TrendingDown,
  Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getDebtCards, createDebtCard, updateDebtCard, deleteDebtCard } from '../../lib/debtApi';

// --- Constants ---
const MAX_SIMULATION_MONTHS = 600; // 50 years sanity check

// --- Utils ---
const formatCurrency = (val) => 
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val);

const formatDate = (date) => 
  new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);

// --- Simulation Logic ---
function calculateCurrentState(card) {
  // Initial state
  const initialTransferTotal = card.balanceTransfers.reduce((sum, bt) => sum + bt.amount, 0);
  let aprBalance = Math.max(0, card.totalDebt - initialTransferTotal);
  
  let activeTransfers = card.balanceTransfers.map(bt => ({
    ...bt,
    currentBalance: bt.amount,
    endDate: new Date(bt.endDate)
  }));

  let currentMonthlyPayment = card.monthlyPayment;

  // Set base date (defaulting missing or old dates to April 30, 2026)
  let baseDate = new Date(card.updatedAt || card.createdAt || '2026-04-30T00:00:00Z');
  const defaultDate = new Date('2026-04-30T00:00:00Z');
  if (baseDate < defaultDate) baseDate = defaultDate;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let simulationDate = new Date(baseDate);
  simulationDate.setHours(0, 0, 0, 0);

  while (true) {
    let nextYear = simulationDate.getFullYear();
    let nextMonth = simulationDate.getMonth();
    
    let lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
    let targetDay = Math.min(card.paymentDate || 1, lastDayOfMonth);

    if (simulationDate.getDate() >= targetDay) {
      nextMonth++;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear++;
      }
      lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
      targetDay = Math.min(card.paymentDate || 1, lastDayOfMonth);
    }
    let nextPaymentDate = new Date(nextYear, nextMonth, targetDay);
    nextPaymentDate.setHours(0, 0, 0, 0);

    if (nextPaymentDate > today) {
      break;
    }

    simulationDate = nextPaymentDate;

    // Process expired transfers
    const expired = activeTransfers.filter(t => simulationDate >= t.endDate && t.currentBalance > 0);
    expired.forEach(t => {
      aprBalance += t.currentBalance;
      t.currentBalance = 0;
      if (t.postOfferPayment && t.postOfferPayment > currentMonthlyPayment) {
        currentMonthlyPayment = t.postOfferPayment;
      }
    });
    activeTransfers = activeTransfers.filter(t => simulationDate < t.endDate || t.currentBalance > 0);

    // Interest
    const monthlyRate = (card.apr / 100) / 12;
    const interest = aprBalance * monthlyRate;
    aprBalance += interest;

    // Payment Allocation
    let paymentRemaining = currentMonthlyPayment;
    
    while (paymentRemaining > 0 && (aprBalance > 0 || activeTransfers.some(t => t.currentBalance > 0))) {
      let targetPot = null;
      if (aprBalance > 0) {
        targetPot = { type: 'apr', balance: aprBalance, id: 'apr' };
      } else {
        const transfers = activeTransfers.filter(t => t.currentBalance > 0).sort((a, b) => b.currentBalance - a.currentBalance);
        if (transfers.length > 0) {
          targetPot = { type: 'transfer', balance: transfers[0].currentBalance, id: transfers[0].id };
        }
      }

      if (!targetPot) break;

      const amountToPay = Math.min(targetPot.balance, paymentRemaining);
      
      if (targetPot.type === 'apr') {
        aprBalance -= amountToPay;
      } else {
        const transfer = activeTransfers.find(t => t.id === targetPot.id);
        if (transfer) transfer.currentBalance -= amountToPay;
      }
      
      paymentRemaining -= amountToPay;
    }

    // Post BT logic if all BTs are paid off
    if (activeTransfers.every(t => t.currentBalance <= 0) && card.balanceTransfers.length > 0) {
      const maxPostOffer = Math.max(...card.balanceTransfers.map(t => Number(t.postOfferPayment) || 0));
      if (maxPostOffer > currentMonthlyPayment) {
        currentMonthlyPayment = maxPostOffer;
      }
    }
  }

  const totalRemaining = aprBalance + activeTransfers.reduce((sum, t) => sum + t.currentBalance, 0);

  return {
    ...card,
    calculatedTotalDebt: Math.max(0, totalRemaining),
    calculatedAprBalance: Math.max(0, aprBalance),
    calculatedTransfers: activeTransfers,
    calculatedMonthlyPayment: currentMonthlyPayment,
  };
}

function simulatePayoff(currentState) {
  const steps = [];
  let currentMonth = 0;
  let totalInterest = 0;
  
  let aprBalance = currentState.calculatedAprBalance;
  let activeTransfers = currentState.calculatedTransfers.map(t => ({ ...t, endDate: new Date(t.endDate) }));
  let currentMonthlyPayment = currentState.calculatedMonthlyPayment;

  let simulationDate = new Date();
  simulationDate.setHours(0, 0, 0, 0);
  
  const card = currentState; 

  while ((aprBalance > 0 || activeTransfers.some(t => t.currentBalance > 0)) && currentMonth < MAX_SIMULATION_MONTHS) {
    let nextYear = simulationDate.getFullYear();
    let nextMonth = simulationDate.getMonth();
    
    let lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
    let targetDay = Math.min(card.paymentDate || 1, lastDayOfMonth);

    if (simulationDate.getDate() >= targetDay) {
      nextMonth++;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear++;
      }
      lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
      targetDay = Math.min(card.paymentDate || 1, lastDayOfMonth);
    }
    let nextPaymentDate = new Date(nextYear, nextMonth, targetDay);
    nextPaymentDate.setHours(0, 0, 0, 0);
    simulationDate = nextPaymentDate;

    // Process expired transfers
    const expired = activeTransfers.filter(t => simulationDate >= t.endDate && t.currentBalance > 0);
    expired.forEach(t => {
      aprBalance += t.currentBalance;
      t.currentBalance = 0;
      if (t.postOfferPayment && t.postOfferPayment > currentMonthlyPayment) {
        currentMonthlyPayment = t.postOfferPayment;
      }
    });
    activeTransfers = activeTransfers.filter(t => simulationDate < t.endDate || t.currentBalance > 0);

    // Interest
    const monthlyRate = (card.apr / 100) / 12;
    const interest = aprBalance * monthlyRate;
    aprBalance += interest;
    totalInterest += interest;

    // Safety check
    if (aprBalance > 0 && currentMonthlyPayment <= interest && currentMonth > 100) {
       return { steps, totalInterest, payoffDate: null, monthsToPayoff: currentMonth, isInfinite: true };
    }

    // Payment Allocation
    let paymentRemaining = currentMonthlyPayment;
    let paymentApplied = 0;
    
    while (paymentRemaining > 0 && (aprBalance > 0 || activeTransfers.some(t => t.currentBalance > 0))) {
      let targetPot = null;
      if (aprBalance > 0) {
        targetPot = { type: 'apr', balance: aprBalance, id: 'apr' };
      } else {
        const transfers = activeTransfers.filter(t => t.currentBalance > 0).sort((a, b) => b.currentBalance - a.currentBalance);
        if (transfers.length > 0) {
          targetPot = { type: 'transfer', balance: transfers[0].currentBalance, id: transfers[0].id };
        }
      }

      if (!targetPot) break;

      const amountToPay = Math.min(targetPot.balance, paymentRemaining);
      
      if (targetPot.type === 'apr') {
        aprBalance -= amountToPay;
      } else {
        const transfer = activeTransfers.find(t => t.id === targetPot.id);
        if (transfer) transfer.currentBalance -= amountToPay;
      }
      
      paymentRemaining -= amountToPay;
      paymentApplied += amountToPay;
    }

    // Post BT logic
    if (activeTransfers.every(t => t.currentBalance <= 0) && card.balanceTransfers.length > 0) {
      const maxPostOffer = Math.max(...card.balanceTransfers.map(t => Number(t.postOfferPayment) || 0));
      if (maxPostOffer > currentMonthlyPayment) {
        currentMonthlyPayment = maxPostOffer;
      }
    }

    currentMonth++;

    const totalRemaining = aprBalance + activeTransfers.reduce((sum, t) => sum + t.currentBalance, 0);

    steps.push({
      month: currentMonth,
      date: simulationDate,
      totalRemaining: Math.max(0, totalRemaining),
      interestCharged: interest,
      paymentApplied: paymentApplied,
      aprBalance,
      transferBalances: activeTransfers.map(t => t.currentBalance)
    });

    if (totalRemaining <= 0) break;
  }

  return {
    steps,
    totalInterest,
    payoffDate: currentMonth < MAX_SIMULATION_MONTHS ? simulationDate : null,
    monthsToPayoff: currentMonth,
    isInfinite: currentMonth >= MAX_SIMULATION_MONTHS
  };
}

// --- Component ---
export default function DebtFlowPage() {
  const [cards, setCards] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const [editingCardId, setEditingCardId] = useState(null);

  // Form State
  const [newCard, setNewCard] = useState({
    name: '',
    totalDebt: 0,
    apr: 18,
    monthlyPayment: 50,
    paymentDate: 1,
    balanceTransfers: []
  });

  const openAddModal = () => {
    setEditingCardId(null);
    setNewCard({ name: '', totalDebt: 0, apr: 18, monthlyPayment: 50, paymentDate: 1, balanceTransfers: [] });
    setIsAdding(true);
  };

  const openEditModal = (card) => {
    setEditingCardId(card.id);
    setNewCard({
      ...card,
      totalDebt: card.calculatedTotalDebt.toFixed(2),
      monthlyPayment: card.calculatedMonthlyPayment.toFixed(2),
      balanceTransfers: card.calculatedTransfers.map(bt => ({
        ...bt,
        amount: bt.currentBalance.toFixed(2),
        endDate: new Date(bt.endDate).toISOString().split('T')[0] // Format for date input
      }))
    });
    setIsAdding(true);
  };

  useEffect(() => {
    loadCards();
  }, []);

  const loadCards = async () => {
    try {
      const data = await getDebtCards();
      setCards(data);
    } catch (err) {
      console.error('Failed to load cards', err);
    } finally {
      setLoading(false);
    }
  };

  const saveCard = async () => {
    if (!newCard.name) return;
    try {
      if (editingCardId) {
        const updated = await updateDebtCard(editingCardId, newCard);
        setCards(cards.map(c => c.id === editingCardId ? updated : c));
      } else {
        const created = await createDebtCard(newCard);
        setCards([created, ...cards]);
      }
      setIsAdding(false);
    } catch (err) {
      console.error('Failed to save card', err);
    }
  };

  const removeCard = async (id) => {
    try {
      await deleteDebtCard(id);
      setCards(cards.filter(c => c.id !== id));
    } catch (err) {
      console.error('Failed to remove card', err);
    }
  };

  const addTransferToDraft = () => {
    const newBT = {
      id: crypto.randomUUID(),
      amount: 0,
      endDate: new Date().toISOString().split('T')[0],
      postOfferPayment: ''
    };
    setNewCard({
      ...newCard,
      balanceTransfers: [...(newCard.balanceTransfers || []), newBT]
    });
  };

  const updateTransferInDraft = (id, updates) => {
    setNewCard({
      ...newCard,
      balanceTransfers: newCard.balanceTransfers?.map(bt => 
        bt.id === id ? { ...bt, ...updates } : bt
      )
    });
  };

  const removeTransferFromDraft = (id) => {
    setNewCard({
      ...newCard,
      balanceTransfers: newCard.balanceTransfers?.filter(bt => bt.id !== id)
    });
  };

  const processedCards = useMemo(() => cards.map(calculateCurrentState), [cards]);

  const totalCalculatedInterest = useMemo(() => 
    processedCards.reduce((sum, c) => sum + simulatePayoff(c).totalInterest, 0),
  [processedCards]);

  const totalDebt = useMemo(() => 
    processedCards.reduce((sum, c) => sum + c.calculatedTotalDebt, 0),
  [processedCards]);

  const totalMonthlyPayments = useMemo(() => 
    processedCards.reduce((sum, c) => sum + c.calculatedMonthlyPayment, 0),
  [processedCards]);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading portfolio...</div>;

  return (
    <div className="bg-slate-50 text-slate-900 font-sans flex flex-col transition-colors duration-300 min-h-full rounded-2xl overflow-hidden border border-slate-200">
      {/* Top Navigation inside the container */}
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold shadow-sm shadow-indigo-100 italic">D</div>
          <span className="text-xl font-bold tracking-tight">DebtFlow Pro</span>
        </div>
        <div className="flex items-center gap-6 text-sm font-medium">
          <button 
            onClick={openAddModal}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-all shadow-sm flex items-center gap-2 active:scale-95"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">Add Card</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Sidebar Overview */}
        <aside className="w-full lg:w-80 bg-white border-r border-slate-200 p-6 lg:p-8 flex flex-col gap-6 lg:gap-8 overflow-y-auto">
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Portfolio Summary</h3>
            <div className="space-y-3">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 transition-all hover:bg-slate-100/50">
                <p className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1.5 uppercase">
                  <PoundSterling size={12} className="text-slate-400" />
                  Combined Debt
                </p>
                <p className="text-xl font-bold tracking-tight">{formatCurrency(totalDebt)}</p>
              </div>
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 transition-all hover:bg-emerald-100/50">
                <p className="text-xs text-emerald-600 font-medium mb-1 flex items-center gap-1.5 uppercase">
                  <TrendingDown size={12} className="text-emerald-500" />
                  Interest Liability
                </p>
                <p className="text-xl font-bold tracking-tight text-emerald-700">{formatCurrency(totalCalculatedInterest)}</p>
              </div>
              <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 transition-all hover:bg-indigo-100/50">
                <p className="text-xs text-indigo-600 font-medium mb-1 flex items-center gap-1.5 uppercase">
                  <Calendar size={12} className="text-indigo-500" />
                  Total Monthly Payments
                </p>
                <p className="text-xl font-bold tracking-tight text-indigo-700">{formatCurrency(totalMonthlyPayments)}</p>
              </div>
            </div>
          </div>
          
          <div className="flex-1 lg:overflow-y-auto custom-scrollbar">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">My Cards</h3>
            <div className="space-y-2">
              {processedCards.map(card => (
                <a href={`#card-${card.id}`} key={card.id} className="block p-3 hover:bg-slate-50 border border-transparent hover:border-slate-100 rounded-xl cursor-pointer group transition-all">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-slate-700 group-hover:text-indigo-600 transition-colors text-sm">{card.name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{card.apr}%</span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">{formatCurrency(card.calculatedTotalDebt)} live remaining</p>
                </a>
              ))}
              {cards.length === 0 && (
                <div className="p-6 text-center border-2 border-dashed border-slate-100 rounded-2xl">
                  <p className="text-xs text-slate-400 font-medium italic">Empty Portfolio</p>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 hidden lg:block">
             <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 text-indigo-700">
                <div className="flex gap-3 items-start">
                   <Info size={16} className="mt-0.5 flex-shrink-0" />
                   <p className="text-xs leading-relaxed font-medium">
                      Payments are allocated to the <strong>largest balance</strong> to aggressively reduce payoff timelines.
                   </p>
                </div>
             </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto overflow-x-hidden relative scroll-smooth h-full">
          <div className="max-w-4xl mx-auto space-y-8 pb-10">
            {cards.length === 0 && !isAdding && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 bg-indigo-50 text-indigo-200 rounded-2xl flex items-center justify-center mb-5">
                  <CreditCard size={32} />
                </div>
                <h2 className="text-xl font-bold tracking-tight mb-2 italic">Ready to clear your debt?</h2>
                <p className="text-slate-500 max-w-sm mb-6 text-sm leading-relaxed">
                  Join DebtFlow Pro and visualize exactly when you'll reach financial freedom with our smart tier-based calculation engine.
                </p>
                <button 
                  onClick={openAddModal}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 hover:scale-[1.02] active:scale-95 text-sm"
                >
                  Create Your First Card
                </button>
              </div>
            )}

            <AnimatePresence>
              {processedCards.map((card) => {
                const results = simulatePayoff(card);
                return (
                  <motion.div 
                    key={card.id}
                    layout
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-[1.5rem] border border-slate-200 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300"
                    id={`card-${card.id}`}
                  >
                    <div className="p-6 md:p-8">
                      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 shadow-inner">
                            <CreditCard size={24} />
                          </div>
                          <div>
                            <h2 className="text-xl font-extrabold tracking-tight">{card.name}</h2>
                            <p className="text-slate-500 font-medium uppercase tracking-wide text-[10px]">
                              Card Analytics & Configuration
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                           <button 
                            onClick={() => openEditModal(card)}
                            className="p-2 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                            title="Edit Card"
                          >
                            <Pencil size={18} />
                          </button>
                           <button 
                            onClick={() => removeCard(card.id)}
                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                            title="Remove Card"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>

                      {/* Card Configuration Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-200 transition-colors">
                          <label className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block mb-1.5 px-1">Live Balance</label>
                          <div className="text-xl font-bold font-mono tracking-tighter">{formatCurrency(card.calculatedTotalDebt)}</div>
                        </div>
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-200 transition-colors">
                          <label className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block mb-1.5 px-1">Interest Rate (APR)</label>
                          <div className="text-xl font-bold font-mono tracking-tighter">{card.apr}%</div>
                        </div>
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-200 transition-colors">
                          <label className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block mb-1.5 px-1">Live Monthly Pymt</label>
                          <div className="text-xl font-bold font-mono tracking-tighter text-indigo-600">
                             {formatCurrency(card.calculatedMonthlyPayment)}
                          </div>
                        </div>
                      </div>

                      {/* Balance Transfers Board */}
                      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
                        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                          <h2 className="font-bold flex items-center gap-2 text-sm text-slate-700">
                            <History size={16} className="text-indigo-500" />
                            Balance Transfers (0% Interest)
                          </h2>
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                            Active: {card.balanceTransfers.length}
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-[9px] text-slate-400 font-extrabold border-b border-slate-100 uppercase tracking-widest">
                                <th className="px-5 py-3">Amount</th>
                                <th className="px-5 py-3">End Date</th>
                                <th className="px-5 py-3">Post-Offer Payment</th>
                              </tr>
                            </thead>
                            <tbody className="text-sm">
                              {card.calculatedTransfers.map((bt) => {
                                const expDate = new Date(bt.endDate);
                                return (
                                  <tr key={bt.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors group">
                                    <td className="px-5 py-4 font-bold text-slate-800">{formatCurrency(bt.currentBalance)}</td>
                                    <td className="px-5 py-4 text-slate-500 font-medium">{formatDate(expDate)}</td>
                                    <td className="px-5 py-4 text-slate-500 font-medium">
                                      {bt.postOfferPayment ? formatCurrency(bt.postOfferPayment) : '-'}
                                    </td>
                                  </tr>
                                );
                              })}
                              {card.balanceTransfers.length === 0 && (
                                <tr>
                                  <td colSpan={3} className="px-5 py-6 text-center text-slate-400 italic text-xs font-medium">
                                    No balance transfers configured for this card.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Payoff Result Box */}
                      <div className={`p-6 rounded-[1.5rem] text-white flex flex-col md:flex-row items-center justify-between shadow-xl transition-all ${results.isInfinite ? 'bg-rose-600 shadow-rose-200' : 'bg-indigo-950 shadow-indigo-200'}`}>
                        <div className="flex items-center gap-6 mb-4 md:mb-0">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 ${results.isInfinite ? 'bg-rose-500 border-rose-400/50' : 'bg-indigo-900 border-indigo-800/50'}`}>
                            {results.isInfinite ? (
                              <AlertCircle size={24} className="text-rose-200 animate-pulse" />
                            ) : (
                              <Calendar size={24} className="text-indigo-300" />
                            )}
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-0.5">
                              {results.isInfinite ? 'Warning: Payment Insufficient' : 'Calculated Payoff Date'}
                            </p>
                            <h2 className="text-2xl font-black tracking-tighter">
                              {results.isInfinite ? 'Never Paid' : results.payoffDate ? formatDate(results.payoffDate) : '--'}
                            </h2>
                          </div>
                        </div>
                        <div className={`text-center md:text-right md:border-l md:pl-8 h-full flex flex-col justify-center ${results.isInfinite ? 'border-rose-500/30' : 'border-indigo-800/50'}`}>
                          <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-0.5">Estimated Total Interest</p>
                          <p className={`text-xl font-black tracking-tight ${results.isInfinite ? 'text-rose-200' : 'text-emerald-400'}`}>
                            {results.isInfinite ? 'N/A' : formatCurrency(results.totalInterest)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Add Card Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">{editingCardId ? 'Edit Credit Account' : 'New Credit Account'}</h2>
                    <p className="text-slate-500 text-[10px] font-medium uppercase tracking-widest mt-1">Configure debt parameters</p>
                  </div>
                  <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-slate-50 rounded-full transition-colors text-slate-400">
                    <ChevronDown size={20} />
                  </button>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase mb-1.5 tracking-widest px-1">Card Description</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Chase Freedom Unlimited" 
                      className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold text-slate-700 placeholder:text-slate-300 text-sm"
                      value={newCard.name}
                      onChange={e => setNewCard({...newCard, name: e.target.value})}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[9px] font-extrabold text-slate-400 uppercase mb-1.5 tracking-widest px-1">Total Debt (£)</label>
                      <input 
                        type="number" 
                        className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold text-sm"
                        value={newCard.totalDebt}
                        onChange={e => setNewCard({...newCard, totalDebt: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-extrabold text-slate-400 uppercase mb-1.5 tracking-widest px-1">Interest APR (%)</label>
                      <input 
                        type="number" 
                        className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold text-sm"
                        value={newCard.apr}
                        onChange={e => setNewCard({...newCard, apr: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[9px] font-extrabold text-slate-400 uppercase mb-1.5 tracking-widest px-1">Monthly Repayment (£)</label>
                      <input 
                        type="number" 
                        className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold text-indigo-600 text-sm"
                        value={newCard.monthlyPayment}
                        onChange={e => setNewCard({...newCard, monthlyPayment: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-extrabold text-slate-400 uppercase mb-1.5 tracking-widest px-1">Payment Date (1-31)</label>
                      <input 
                        type="number" 
                        min="1"
                        max="31"
                        className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold text-indigo-600 text-sm"
                        value={newCard.paymentDate}
                        onChange={e => setNewCard({...newCard, paymentDate: e.target.value})}
                      />
                    </div>
                  </div>

                  {/* Balance Transfers */}
                  <div className="pt-2">
                    <div className="flex justify-between items-center mb-3">
                      <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest px-1">0% Balance Transfers</label>
                      <button 
                        onClick={addTransferToDraft}
                        className="text-[9px] font-black text-indigo-600 hover:text-indigo-700 flex items-center gap-1 uppercase transition-colors"
                      >
                        <Plus size={12} strokeWidth={4} /> Add Transaction
                      </button>
                    </div>
                    
                    <div className="space-y-3 pr-2">
                      {newCard.balanceTransfers?.map((bt) => (
                        <div key={bt.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 relative group flex gap-4">
                          <div className="flex-1">
                            <p className="text-[8px] font-extrabold text-slate-400 uppercase mb-1">Transfer</p>
                            <input 
                              type="number" 
                              className="w-full bg-transparent border-b border-slate-200 focus:border-indigo-500 py-1 font-mono font-bold text-xs outline-none transition-colors"
                              value={bt.amount}
                              onChange={e => updateTransferInDraft(bt.id, { amount: e.target.value })}
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-[8px] font-extrabold text-slate-400 uppercase mb-1">End Date</p>
                            <input 
                              type="date" 
                              className="w-full bg-transparent border-b border-slate-200 focus:border-indigo-500 py-1 font-mono font-bold text-xs outline-none transition-colors text-slate-700"
                              value={bt.endDate}
                              onChange={e => updateTransferInDraft(bt.id, { endDate: e.target.value })}
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-[8px] font-extrabold text-slate-400 uppercase mb-1" title="What will you pay when this offer expires?">Post-Offer Pymt (£)</p>
                            <input 
                              type="number" 
                              placeholder="Optional"
                              className="w-full bg-transparent border-b border-slate-200 focus:border-indigo-500 py-1 font-mono font-bold text-xs outline-none transition-colors"
                              value={bt.postOfferPayment || ''}
                              onChange={e => updateTransferInDraft(bt.id, { postOfferPayment: e.target.value })}
                            />
                          </div>
                          <button 
                            onClick={() => removeTransferFromDraft(bt.id)}
                            className="absolute -top-1 -right-1 p-1.5 bg-white shadow-md border border-slate-100 rounded-full text-slate-300 hover:text-red-500 transition-all hover:scale-110"
                          >
                            <Trash2 size={10} strokeWidth={2.5} />
                          </button>
                        </div>
                      ))}
                      {(!newCard.balanceTransfers || newCard.balanceTransfers.length === 0) && (
                        <div className="py-4 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 text-[9px] font-bold uppercase tracking-widest italic">
                          No promotional transfers active
                        </div>
                      )}
                    </div>
                  </div>

                  <button 
                    onClick={saveCard}
                    className="w-full bg-indigo-600 hover:bg-slate-900 text-white py-3.5 rounded-xl font-black text-sm transition-all shadow-md shadow-indigo-100 hover:scale-[1.01] active:scale-[0.98] mt-2 flex items-center justify-center gap-2"
                  >
                    Confirm & Analyze Portfolio
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #CBD5E1; }
        input[type="number"]::-webkit-inner-spin-button, 
        input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      `}</style>
    </div>
  );
}
