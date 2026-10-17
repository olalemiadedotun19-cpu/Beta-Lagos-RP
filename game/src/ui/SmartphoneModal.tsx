import React, { useState } from 'react';
import { PlayerData, PlayerStats } from '../types/game';
import { formatCurrency, formatGameDateTime } from '../utils/math';
import { bankService, BankTransaction } from '../services/BankService';
import { messagingService, ConversationThread } from '../services/MessagingService';
import { jobService, JobVacancy } from '../services/JobService';
import { weatherService } from '../services/WeatherService';
import { notificationService } from '../services/NotificationService';
import {
  X,
  CreditCard,
  MessageSquare,
  Briefcase,
  CloudSun,
  Settings as SettingsIcon,
  Bell,
  Wifi,
  Battery,
  Send,
  UserPlus,
  PhoneCall,
  Search,
  CheckCircle,
  AlertCircle,
  Shield,
  ArrowRight,
  Info,
  Car,
} from 'lucide-react';

interface SmartphoneModalProps {
  playerData: PlayerData;
  stats: PlayerStats;
  currentDate: any;
  cameraSettings: {
    sensitivity: number;
    invertY: boolean;
  };
  onUpdateCameraSettings: (settings: { sensitivity: number; invertY: boolean }) => void;
  /** is the player's BMW out? */
  carSpawned: boolean;
  /** spawns the BMW next to the character, or sends it away if it is out */
  onToggleCar: () => Promise<{ ok: boolean; message: string }>;
  onClose: () => void;
}

type PhoneApp =
  | 'home'
  | 'bank'
  | 'messages'
  | 'jobs'
  | 'weather'
  | 'notifications'
  | 'settings'
  | 'emergency'
  | 'car';

export const SmartphoneModal: React.FC<SmartphoneModalProps> = ({
  playerData,
  currentDate,
  cameraSettings,
  onUpdateCameraSettings,
  carSpawned,
  onToggleCar,
  onClose,
}) => {
  const [currentApp, setCurrentApp] = useState<PhoneApp>('home');
  const { timeStr } = formatGameDateTime(currentDate);

  // Settings states
  const [sensitivity, setSensitivity] = useState<number>(cameraSettings.sensitivity);
  const [invertY, setInvertY] = useState<boolean>(cameraSettings.invertY);

  // Banking State
  const [transferRecipient, setTransferRecipient] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferFeedback, setTransferFeedback] = useState<{ success: boolean; message: string } | null>(null);

  // Messaging State
  const [activeThreadContact, setActiveThreadContact] = useState<string | null>(null);
  const [newMessageRecipient, setNewMessageRecipient] = useState('');
  const [newMessageText, setNewMessageText] = useState('');

  // Rides State

  // Jobs State
  const [jobFeedback, setJobFeedback] = useState<string | null>(null);

  // Car State
  const [carBusy, setCarBusy] = useState(false);
  const [carFeedback, setCarFeedback] = useState<string | null>(null);

  const handleToggleCar = async () => {
    if (carBusy) return;
    setCarBusy(true);
    setCarFeedback(null);
    const result = await onToggleCar();
    setCarBusy(false);
    if (!result.ok) {
      setCarFeedback(result.message);
      setTimeout(() => setCarFeedback(null), 4000);
    }
  };

  const handleSensitivityChange = (val: number) => {
    setSensitivity(val);
    onUpdateCameraSettings({ sensitivity: val, invertY });
  };

  const handleInvertYToggle = () => {
    const next = !invertY;
    setInvertY(next);
    onUpdateCameraSettings({ sensitivity, invertY: next });
  };

  const handleExecuteTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(transferAmount);
    const result = bankService.executeTransfer(playerData, transferRecipient, amountNum);
    setTransferFeedback(result);
    if (result.success) {
      setTransferAmount('');
      setTransferRecipient('');
      notificationService.post({
        title: 'Transfer Sent',
        body: result.message,
        type: 'finance',
      });
    }
    setTimeout(() => setTransferFeedback(null), 4000);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const recipient = activeThreadContact || newMessageRecipient;
    if (!recipient.trim() || !newMessageText.trim()) return;

    messagingService.sendMessage(playerData.identity.username, recipient, newMessageText);
    setNewMessageText('');
    if (!activeThreadContact) {
      setActiveThreadContact(recipient.trim().toLowerCase().replace(/^@/, ''));
    }
  };

  const handleApplyJob = (vacancyId: string) => {
    const result = jobService.applyForJob(playerData, vacancyId);
    setJobFeedback(result.message);
    if (result.success) {
      notificationService.post({
        title: 'Employment Offer Accepted',
        body: result.message,
        type: 'work',
      });
    }
    setTimeout(() => setJobFeedback(null), 4000);
  };

  const weather = weatherService.getCurrentWeather(currentDate.hour < 6 || currentDate.hour >= 19);
  const unreadNotifCount = notificationService.getUnreadCount();

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 touch-none select-none"
      onClick={onClose}
    >
      {/* Original Smartphone Hardware Frame: AuraOS Device */}
      <div
        className="relative bg-slate-950 border-[5px] border-slate-800 rounded-[40px] w-full max-w-[340px] h-[650px] max-h-[92vh] shadow-2xl flex flex-col overflow-hidden ring-1 ring-slate-700/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dynamic Island / Hardware Sensor Bar */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-28 h-5 bg-black rounded-full z-30 flex items-center justify-between px-3">
          <div className="w-2.5 h-2.5 rounded-full bg-slate-900 border border-slate-700" />
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-900/40" />
        </div>

        {/* Phone Top Status Bar */}
        <div className="pt-2 px-5 pb-1 flex justify-between items-center text-[10px] text-slate-300 font-mono z-20 shrink-0">
          <span>{timeStr}</span>
          <div className="flex items-center gap-1.5">
            <Wifi className="w-3 h-3 text-slate-300" />
            <span className="text-[9px] font-bold">5G</span>
            <Battery className="w-3.5 h-3.5 text-emerald-400" />
          </div>
        </div>

        {/* Smartphone Screen Content */}
        <div className="flex-1 overflow-y-auto px-4 py-2.5 flex flex-col justify-between text-slate-100">
          {/* ========================================================================= */}
          {/* 1. HOME SCREEN: Grid of Core Life Systems                                 */}
          {/* ========================================================================= */}
          {currentApp === 'home' && (
            <div className="flex flex-col h-full justify-between animate-fade-in">
              <div>
                {/* Clock & Widget */}
                <div className="text-center my-3">
                  <div className="text-3xl font-extrabold tracking-tight font-mono text-white">
                    {timeStr}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {weather.locationName} · {weather.temperatureCelsius}°C {weather.conditionDescription}
                  </div>
                </div>

                {/* Citizen ID Pill Card */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 mb-4 shadow-md">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400 font-mono">@{playerData.identity.username}</span>
                    <span className="text-emerald-400 font-bold font-mono">
                      {formatCurrency(playerData.finances.cash, playerData.finances.currencySymbol)}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-white">
                    {playerData.identity.firstName} {playerData.identity.lastName}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {playerData.career.isEmployed ? playerData.career.jobTitle : 'Unemployed Resident'}
                  </div>
                </div>

                {/* Application Grid */}
                <div className="grid grid-cols-4 gap-2.5 text-center">
                  {/* Bank / Lagos Pay */}
                  <button
                    onClick={() => setCurrentApp('bank')}
                    className="flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium truncate w-full">Bank</span>
                  </button>

                  {/* Messages */}
                  <button
                    onClick={() => setCurrentApp('messages')}
                    className="flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform relative">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium truncate w-full">Messages</span>
                  </button>

                  {/* Careers */}
                  <button
                    onClick={() => setCurrentApp('jobs')}
                    className="flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium truncate w-full">Careers</span>
                  </button>

                  {/* Weather */}
                  <button
                    onClick={() => setCurrentApp('weather')}
                    className="flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-sky-600 flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform">
                      <CloudSun className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium truncate w-full">Weather</span>
                  </button>

                  {/* Notifications */}
                  <button
                    onClick={() => setCurrentApp('notifications')}
                    className="flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-rose-600 flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform relative">
                      <Bell className="w-5 h-5" />
                      {unreadNotifCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-white text-rose-600 rounded-full text-[9px] font-bold flex items-center justify-center">
                          {unreadNotifCount}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium truncate w-full">Alerts</span>
                  </button>

                  {/* Emergency */}
                  <button
                    onClick={() => setCurrentApp('emergency')}
                    className="flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-red-700 flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform">
                      <Shield className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium truncate w-full">Help 112</span>
                  </button>

                  {/* Car */}
                  <button
                    onClick={() => setCurrentApp('car')}
                    className="flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-amber-600 flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform">
                      <Car className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium truncate w-full">Car</span>
                  </button>

                  {/* Settings */}
                  <button
                    onClick={() => setCurrentApp('settings')}
                    className="flex flex-col items-center gap-1 p-1 rounded-xl hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-slate-700 flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform">
                      <SettingsIcon className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium truncate w-full">Settings</span>
                  </button>
                </div>
              </div>

              {/* Bottom Quick Bar */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-2 flex justify-around mb-2">
                <button onClick={() => setCurrentApp('bank')} className="p-2 text-slate-300 hover:text-white">
                  <CreditCard className="w-5 h-5" />
                </button>
                <button onClick={() => setCurrentApp('messages')} className="p-2 text-slate-300 hover:text-white">
                  <MessageSquare className="w-5 h-5" />
                </button>
                <button onClick={() => setCurrentApp('settings')} className="p-2 text-slate-300 hover:text-white">
                  <SettingsIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 2. BANK APP: Real Authenticated Finances (Zero Fake Data)                 */}
          {/* ========================================================================= */}
          {currentApp === 'bank' && (
            <div className="space-y-3.5 animate-fade-in flex flex-col h-full text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-bold text-sm text-white">Lagos Premier Bank</h3>
                </div>
                <button onClick={() => setCurrentApp('home')} className="text-xs text-slate-400 hover:text-white">
                  Back
                </button>
              </div>

              {/* Real Bank Account Card */}
              <div className="bg-gradient-to-tr from-emerald-950 via-slate-900 to-emerald-800/40 p-4 rounded-2xl border border-emerald-600/40 shadow-xl space-y-2">
                <div className="flex justify-between items-center text-[10px] text-emerald-300">
                  <span>Nigeria Citizen Account</span>
                  <span className="font-mono font-bold">VERVE</span>
                </div>
                <div className="text-xl font-mono font-bold text-white tracking-wider">
                  {formatCurrency(playerData.finances.bankBalance, playerData.finances.currencySymbol)}
                </div>
                <div className="flex justify-between items-end text-[10px] text-slate-300">
                  <span>
                    {playerData.identity.firstName} {playerData.identity.lastName}
                  </span>
                  <span className="font-mono">@{playerData.identity.username}</span>
                </div>
              </div>

              {/* Physical Pocket Cash */}
              <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-400">Physical Pocket Cash</span>
                <span className="font-mono font-bold text-emerald-400">
                  {formatCurrency(playerData.finances.cash, playerData.finances.currencySymbol)}
                </span>
              </div>

              {/* Transfer Form */}
              <form onSubmit={handleExecuteTransfer} className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="font-semibold text-white text-[11px]">Send Online Transfer</div>
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={transferRecipient}
                    onChange={(e) => setTransferRecipient(e.target.value)}
                    placeholder="Recipient @username"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <input
                    type="number"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    placeholder="Amount in ₦"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs cursor-pointer transition-colors"
                >
                  Send Funds
                </button>
              </form>

              {transferFeedback && (
                <div
                  className={`p-2 rounded-lg text-xs text-center flex items-center justify-center gap-1.5 ${
                    transferFeedback.success
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-600'
                      : 'bg-rose-950 text-rose-300 border border-rose-600'
                  }`}
                >
                  {transferFeedback.success ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  <span>{transferFeedback.message}</span>
                </div>
              )}

              {/* Transaction Ledger (Strictly Genuine) */}
              <div className="space-y-1.5 flex-1 overflow-y-auto">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Transaction Ledger
                </div>
                {bankService.getTransactions().length === 0 ? (
                  <div className="text-center py-6 text-slate-500 border border-dashed border-slate-800 rounded-xl">
                    <CreditCard className="w-6 h-6 mx-auto mb-1 opacity-40" />
                    <span>No transactions recorded yet.</span>
                  </div>
                ) : (
                  bankService.getTransactions().map((tx) => (
                    <div key={tx.id} className="bg-slate-900/80 p-2 rounded-lg border border-slate-800 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-semibold text-slate-200">{tx.title}</div>
                        <div className="text-[10px] text-slate-400 capitalize">{tx.category}</div>
                      </div>
                      <span className={`font-mono font-bold ${tx.type === 'credit' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {tx.type === 'credit' ? '+' : '-'}₦{tx.amount.toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 3. MESSAGES APP: Online-First Architecture (Authentic Empty State)        */}
          {/* ========================================================================= */}
          {currentApp === 'messages' && (
            <div className="space-y-3 animate-fade-in flex flex-col h-full text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-400" />
                  <h3 className="font-bold text-sm text-white">Citizen Messages</h3>
                </div>
                <button
                  onClick={() => {
                    if (activeThreadContact) {
                      setActiveThreadContact(null);
                    } else {
                      setCurrentApp('home');
                    }
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  {activeThreadContact ? 'Inbox' : 'Back'}
                </button>
              </div>

              {!activeThreadContact ? (
                // Threads Inbox
                <div className="flex-1 flex flex-col justify-between overflow-hidden">
                  <div className="space-y-2 overflow-y-auto flex-1">
                    {messagingService.getConversations().length === 0 ? (
                      <div className="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-2xl p-4">
                        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <div className="font-semibold text-slate-400">No messages yet.</div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Direct messages from citizen contacts and services will appear here.
                        </p>
                      </div>
                    ) : (
                      messagingService.getConversations().map((thread) => (
                        <button
                          key={thread.contact.id}
                          onClick={() => setActiveThreadContact(thread.contact.username)}
                          className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-left flex justify-between items-center hover:bg-slate-800/80 transition-colors"
                        >
                          <div>
                            <div className="font-bold text-slate-100">@{thread.contact.username}</div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[180px]">
                              {thread.lastMessage?.text || 'No messages'}
                            </div>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      ))
                    )}
                  </div>

                  {/* New Message Composer */}
                  <form onSubmit={handleSendMessage} className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Send New Message</div>
                    <input
                      type="text"
                      value={newMessageRecipient}
                      onChange={(e) => setNewMessageRecipient(e.target.value)}
                      placeholder="Recipient @username"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newMessageText}
                        onChange={(e) => setNewMessageText(e.target.value)}
                        placeholder="Type message..."
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="submit"
                        className="px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center justify-center cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                // Active Thread View
                <div className="flex-1 flex flex-col justify-between overflow-hidden">
                  <div className="font-mono text-emerald-400 font-bold mb-1 pb-1 border-b border-slate-800">
                    @{activeThreadContact}
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 py-2">
                    {messagingService
                      .getConversations()
                      .find((c) => c.contact.username.toLowerCase() === activeThreadContact.toLowerCase())
                      ?.messages.map((m) => {
                        const isMe = m.senderUsername === playerData.identity.username;
                        return (
                          <div
                            key={m.id}
                            className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[78%] px-3 py-1.5 rounded-xl text-xs ${
                                isMe ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'
                              }`}
                            >
                              {m.text}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  <form onSubmit={handleSendMessage} className="pt-2 border-t border-slate-800 flex gap-1.5">
                    <input
                      type="text"
                      value={newMessageText}
                      onChange={(e) => setNewMessageText(e.target.value)}
                      placeholder="Reply..."
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      className="px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center justify-center cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* 5. JOBS APP: Career Opportunities (District POI Vacancies)                */}
          {/* ========================================================================= */}
          {currentApp === 'jobs' && (
            <div className="space-y-3 animate-fade-in flex flex-col h-full text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-indigo-400" />
                  <h3 className="font-bold text-sm text-white">District Career Portal</h3>
                </div>
                <button onClick={() => setCurrentApp('home')} className="text-xs text-slate-400 hover:text-white">
                  Back
                </button>
              </div>

              {/* Current Job Status */}
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[10px] uppercase font-bold text-emerald-400">Current Position</div>
                <div className="text-sm font-bold text-white">
                  {playerData.career.isEmployed ? playerData.career.jobTitle : 'Unemployed Freelance'}
                </div>
                <div className="text-xs text-slate-300">{playerData.career.employer}</div>
                <div className="text-[11px] text-emerald-400 font-mono font-semibold">
                  ₦{playerData.career.hourlyWage.toLocaleString()} / hour
                </div>
              </div>

              {jobFeedback && (
                <div className="p-2 bg-emerald-950 border border-emerald-600 rounded-xl text-emerald-300 text-xs">
                  {jobFeedback}
                </div>
              )}

              {/* District Vacancies */}
              <div className="space-y-2 flex-1 overflow-y-auto">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Openings in Ikeja
                </div>
                {jobService.getVacancies().map((v) => (
                  <div key={v.id} className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 space-y-1.5">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-white text-xs">{v.title}</div>
                        <div className="text-[11px] text-slate-400">{v.employerName}</div>
                      </div>
                      <span className="font-mono text-emerald-400 font-bold">₦{v.hourlyWage.toLocaleString()}/hr</span>
                    </div>
                    <p className="text-[11px] text-slate-300">{v.description}</p>
                    <div className="flex justify-between items-center pt-1 border-t border-slate-800 text-[10px] text-slate-400">
                      <span>{v.shiftHours}</span>
                      <button
                        onClick={() => handleApplyJob(v.id)}
                        className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 6. WEATHER APP                                                            */}
          {/* ========================================================================= */}
          {currentApp === 'weather' && (
            <div className="space-y-3.5 animate-fade-in flex flex-col h-full text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <CloudSun className="w-4 h-4 text-sky-400" />
                  <h3 className="font-bold text-sm text-white">Weather Services</h3>
                </div>
                <button onClick={() => setCurrentApp('home')} className="text-xs text-slate-400 hover:text-white">
                  Back
                </button>
              </div>

              <div className="bg-gradient-to-br from-sky-950 via-slate-900 to-slate-950 p-5 rounded-2xl border border-sky-800/40 text-center space-y-2">
                <div className="text-slate-400 text-xs">{weather.locationName}</div>
                <div className="text-4xl font-extrabold font-mono text-white tracking-tight">
                  {weather.temperatureCelsius}°C
                </div>
                <div className="text-sm font-semibold text-sky-300">{weather.conditionDescription}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400 text-[10px] block">Relative Humidity</span>
                  <span className="font-mono font-bold text-white">{weather.humidityPercent}%</span>
                </div>
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400 text-[10px] block">Wind Speed</span>
                  <span className="font-mono font-bold text-white">{weather.windSpeedKmh} km/h</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 7. NOTIFICATIONS APP                                                      */}
          {/* ========================================================================= */}
          {currentApp === 'notifications' && (
            <div className="space-y-3 animate-fade-in flex flex-col h-full text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-rose-400" />
                  <h3 className="font-bold text-sm text-white">Notifications</h3>
                </div>
                <button onClick={() => setCurrentApp('home')} className="text-xs text-slate-400 hover:text-white">
                  Back
                </button>
              </div>

              <div className="space-y-2 flex-1 overflow-y-auto">
                {notificationService.getNotifications().length === 0 ? (
                  <div className="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-xl p-4">
                    <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <div>No new notifications.</div>
                  </div>
                ) : (
                  notificationService.getNotifications().map((n) => (
                    <div key={n.id} className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-white text-xs">{n.title}</span>
                        <span className="text-[10px] text-slate-500 capitalize">{n.type}</span>
                      </div>
                      <p className="text-[11px] text-slate-300">{n.body}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 8. EMERGENCY 112 APP                                                      */}
          {/* ========================================================================= */}
          {currentApp === 'emergency' && (
            <div className="space-y-3.5 animate-fade-in flex flex-col h-full text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-red-500" />
                  <h3 className="font-bold text-sm text-white">Lagos Emergency 112</h3>
                </div>
                <button onClick={() => setCurrentApp('home')} className="text-xs text-slate-400 hover:text-white">
                  Back
                </button>
              </div>

              <div className="bg-red-950/40 border border-red-800/60 p-4 rounded-2xl text-center space-y-1">
                <div className="text-2xl font-mono font-bold text-red-400">112 / 767</div>
                <p className="text-[11px] text-slate-300">
                  Lagos State Emergency Response & Medical Triage Line.
                </p>
              </div>

              <div className="space-y-2">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">Ikeja General Health Center</div>
                    <div className="text-[10px] text-slate-400">24/7 Emergency Medical Ward</div>
                  </div>
                  <span className="text-emerald-400 font-mono font-bold">Open 24/7</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* CAR APP: call / send away the BMW i8                                      */}
          {/* ========================================================================= */}
          {currentApp === 'car' && (
            <div className="space-y-3.5 animate-fade-in flex flex-col h-full text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-sm text-white">My Car</h3>
                </div>
                <button onClick={() => setCurrentApp('home')} className="text-xs text-slate-400 hover:text-white">
                  Back
                </button>
              </div>

              <div className="bg-gradient-to-br from-amber-950 via-slate-900 to-slate-950 p-5 rounded-2xl border border-amber-800/40 text-center space-y-2">
                <Car className="w-10 h-10 text-amber-300 mx-auto" />
                <div className="text-lg font-extrabold text-white tracking-tight">BMW i8</div>
                <div className={`text-xs font-semibold ${carSpawned ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {carSpawned ? 'Parked next to you' : 'Not spawned'}
                </div>
              </div>

              <button
                onClick={handleToggleCar}
                disabled={carBusy}
                className={`w-full py-3 rounded-xl font-bold text-sm transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait ${
                  carSpawned ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-amber-600 text-white hover:bg-amber-500'
                }`}
              >
                {carBusy ? 'Spawning…' : carSpawned ? 'Despawn car' : 'Spawn car'}
              </button>

              {carFeedback && <div className="text-center text-[11px] text-rose-300">{carFeedback}</div>}

              <div className="mt-auto text-center text-[9px] text-slate-500">
                Model: BMW i8 by iSteven (Sketchfab), CC BY-NC 4.0
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 9. SETTINGS APP                                                           */}
          {/* ========================================================================= */}
          {currentApp === 'settings' && (
            <div className="space-y-4 animate-fade-in flex flex-col h-full text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <SettingsIcon className="w-4 h-4 text-slate-300" />
                  <h3 className="font-bold text-sm text-white">System Settings</h3>
                </div>
                <button onClick={() => setCurrentApp('home')} className="text-xs text-slate-400 hover:text-white">
                  Back
                </button>
              </div>

              <div className="space-y-3.5">
                {/* Camera Sensitivity */}
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-200">Camera Sensitivity</span>
                    <span className="font-mono text-emerald-400 font-bold">{sensitivity.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.4"
                    max="2.5"
                    step="0.1"
                    value={sensitivity}
                    onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                {/* Vertical Invert Option */}
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-slate-200">Invert Y-Axis</div>
                    <div className="text-[10px] text-slate-400">Default OFF: Drag Up = Look Up</div>
                  </div>
                  <button
                    onClick={handleInvertYToggle}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                      invertY ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {invertY ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1 font-mono">
                  <div>OS: AuraOS 2.0 Flagship Edition</div>
                  <div>Network: International Life Mesh v1.0</div>
                  <div>Region: Africa · Nigeria · Lagos · Ikeja</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Home Indicator Bar */}
        <div className="py-2.5 flex items-center justify-center shrink-0">
          <button
            onClick={() => (currentApp === 'home' ? onClose() : setCurrentApp('home'))}
            className="w-28 h-1 bg-slate-500 hover:bg-slate-300 rounded-full cursor-pointer transition-colors"
            title="Home / Close Phone"
          />
        </div>
      </div>
    </div>
  );
};
