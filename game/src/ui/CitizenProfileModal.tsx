import React from 'react';
import { PlayerData, PlayerStats } from '../types/game';
import { formatCurrency, calculateAge, formatGameDateTime } from '../utils/math';
import { X, User, Briefcase, GraduationCap, MapPin, PlusCircle } from 'lucide-react';

interface CitizenProfileModalProps {
  playerData: PlayerData;
  stats: PlayerStats;
  currentDate: any;
  onNewLife: () => void;
  onClose: () => void;
}

export const CitizenProfileModal: React.FC<CitizenProfileModalProps> = ({
  playerData,
  currentDate,
  onNewLife,
  onClose,
}) => {
  const currentAge = calculateAge(playerData.identity.dateOfBirth, currentDate);
  const { dateStr } = formatGameDateTime(currentDate);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <User className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Citizen Passport & Profile</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Passport Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs text-slate-300">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex justify-between items-start border-b border-slate-800/80 pb-2">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                  Federal Republic of Nigeria
                </span>
                <h3 className="text-base font-bold text-white">
                  {playerData.identity.firstName} {playerData.identity.lastName}
                </h3>
                <span className="text-xs font-mono text-emerald-400">
                  @{playerData.identity.username}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 uppercase">Status</span>
                <div className="text-xs font-semibold text-emerald-400">Active Resident</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 block">Age & Sex</span>
                <span className="text-slate-200 capitalize font-medium">
                  {currentAge} Years · {playerData.identity.sex}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Nationality</span>
                <span className="text-slate-200 font-medium">
                  {playerData.identity.nationality}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Current Location</span>
                <span className="text-slate-200 font-medium flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-emerald-400" />
                  <span>Ikeja, Lagos</span>
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Current Simulation Date</span>
                <span className="text-slate-200 font-medium">{dateStr}</span>
              </div>
            </div>
          </div>

          {/* Career & Education */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1 font-semibold">
                <Briefcase className="w-3.5 h-3.5 text-emerald-400" />
                <span>Career</span>
              </div>
              <div className="text-sm font-bold text-white">
                {playerData.career.isEmployed ? playerData.career.jobTitle : 'Freelance'}
              </div>
              <div className="text-[11px] text-slate-400">{playerData.career.employer}</div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1 font-semibold">
                <GraduationCap className="w-3.5 h-3.5 text-emerald-400" />
                <span>Education</span>
              </div>
              <div className="text-sm font-bold text-white">{playerData.education.level}</div>
              <div className="text-[11px] text-slate-400">{playerData.education.schoolName}</div>
            </div>
          </div>

          {/* Finances */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex justify-between items-center">
            <div>
              <span className="text-[10px] uppercase text-slate-500 font-semibold block">Total Wealth</span>
              <span className="text-sm font-mono font-bold text-emerald-400">
                {formatCurrency(playerData.finances.cash + playerData.finances.bankBalance, playerData.finances.currencySymbol)}
              </span>
            </div>
            <div className="text-right text-[11px] text-slate-400">
              <div>Cash: {formatCurrency(playerData.finances.cash, playerData.finances.currencySymbol)}</div>
              <div>Bank: {formatCurrency(playerData.finances.bankBalance, playerData.finances.currencySymbol)}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={onNewLife}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>Create New Character</span>
          </button>
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Close Passport
          </button>
        </div>
      </div>
    </div>
  );
};
