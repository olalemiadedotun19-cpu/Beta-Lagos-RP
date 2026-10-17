import React, { useState } from 'react';
import { LocationAction, POILocation, PlayerData, PlayerStats } from '../types/game';
import { getLocationDefinition } from '../data/locationCatalog';
import { formatCurrency } from '../utils/math';
import { X, Clock, ArrowRight, CheckCircle2, AlertCircle, DoorOpen, LogOut } from 'lucide-react';

interface LocationModalProps {
  poi: POILocation;
  playerData: PlayerData;
  stats: PlayerStats;
  isInterior?: boolean;
  onExecuteAction: (action: LocationAction) => void;
  onEnterInterior?: () => void;
  onExitInterior?: () => void;
  onClose: () => void;
}

export const LocationModal: React.FC<LocationModalProps> = ({
  poi,
  playerData,
  stats,
  isInterior = false,
  onExecuteAction,
  onEnterInterior,
  onExitInterior,
  onClose,
}) => {
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  const locDef = getLocationDefinition(poi.id);

  const handleAction = (action: LocationAction) => {
    // Validate requirements
    if (action.requirements?.minCash && playerData.finances.cash < action.requirements.minCash) {
      alert(`You do not have enough cash! Required: ${formatCurrency(action.requirements.minCash)}`);
      return;
    }
    if (action.requirements?.minEnergy && stats.energy < action.requirements.minEnergy) {
      alert(`You are too exhausted! Required Energy: ${action.requirements.minEnergy}%`);
      return;
    }

    setActiveActionId(action.id);
    onExecuteAction(action);
    setActionSuccessMsg(`Completed "${action.label}"!`);

    setTimeout(() => {
      setActiveActionId(null);
      setTimeout(() => setActionSuccessMsg(null), 2500);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                {poi.type}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400">
                {isInterior ? 'Inside Facility' : 'Ikeja, Lagos'}
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mt-0.5">{poi.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Location Description & Interior Enter/Exit Banner */}
        <div className="px-6 py-3 bg-slate-950/40 border-b border-slate-800/80 text-xs text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>{poi.description}</span>

          {/* Enter Interior Button if currently outside and interior exists */}
          {!isInterior && locDef?.interiorAvailable && onEnterInterior && (
            <button
              onClick={() => {
                onClose();
                onEnterInterior();
              }}
              className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-md transition-all cursor-pointer"
            >
              <DoorOpen className="w-4 h-4" />
              <span>Step Inside</span>
            </button>
          )}

          {/* Exit to Street if currently inside */}
          {isInterior && onExitInterior && (
            <button
              onClick={() => {
                onClose();
                onExitInterior();
              }}
              className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-md transition-all cursor-pointer"
            >
              <LogOut className="w-4 h-4 text-amber-400" />
              <span>Exit to Street</span>
            </button>
          )}
        </div>

        {/* Success toast if action performed */}
        {actionSuccessMsg && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-lg bg-emerald-950 border border-emerald-700 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccessMsg}</span>
          </div>
        )}

        {/* Available Actions List */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            {isInterior ? 'Interior Services & Activities' : 'Available Activities'}
          </h3>

          {poi.actions.map((act) => {
            const hasCashReq = act.requirements?.minCash;
            const canAfford = !hasCashReq || playerData.finances.cash >= hasCashReq;

            const hasEnergyReq = act.requirements?.minEnergy;
            const hasEnergy = !hasEnergyReq || stats.energy >= hasEnergyReq;

            const isBlocked = !canAfford || !hasEnergy;

            return (
              <div
                key={act.id}
                className={`p-4 rounded-xl border transition-all ${
                  isBlocked
                    ? 'bg-slate-950/60 border-slate-800/50 opacity-60'
                    : 'bg-slate-950 border-slate-800 hover:border-emerald-500/50 hover:bg-slate-950/90'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-semibold text-sm text-white flex items-center gap-2">
                      <span>{act.label}</span>
                      {act.earnings && (
                        <span className="text-xs text-emerald-400 font-mono font-bold">
                          +{formatCurrency(act.earnings)}
                        </span>
                      )}
                      {act.cost && (
                        <span className="text-xs text-amber-400 font-mono font-bold">
                          -{formatCurrency(act.cost)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">{act.description}</p>

                    {/* Stat Effects summary */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{act.durationMinutes} mins</span>
                      </span>

                      {act.effects.energy && (
                        <span className={act.effects.energy > 0 ? 'text-amber-400' : 'text-slate-400'}>
                          Energy {act.effects.energy > 0 ? `+${act.effects.energy}` : act.effects.energy}%
                        </span>
                      )}
                      {act.effects.hunger && (
                        <span className={act.effects.hunger > 0 ? 'text-orange-400' : 'text-slate-400'}>
                          Hunger {act.effects.hunger > 0 ? `+${act.effects.hunger}` : act.effects.hunger}%
                        </span>
                      )}
                      {act.effects.health && (
                        <span className={act.effects.health > 0 ? 'text-rose-400' : 'text-slate-400'}>
                          Health {act.effects.health > 0 ? `+${act.effects.health}` : act.effects.health}%
                        </span>
                      )}
                      {act.effects.happiness && (
                        <span className={act.effects.happiness > 0 ? 'text-emerald-400' : 'text-slate-400'}>
                          Happiness {act.effects.happiness > 0 ? `+${act.effects.happiness}` : act.effects.happiness}%
                        </span>
                      )}
                      {act.effects.hygiene && (
                        <span className="text-sky-400">
                          Hygiene +{act.effects.hygiene}%
                        </span>
                      )}
                      {act.effects.stress && (
                        <span className={act.effects.stress < 0 ? 'text-purple-400' : 'text-slate-400'}>
                          Stress {act.effects.stress > 0 ? `+${act.effects.stress}` : act.effects.stress}%
                        </span>
                      )}
                    </div>

                    {/* Warning if requirements not met */}
                    {isBlocked && (
                      <div className="flex items-center gap-1 text-[11px] text-rose-400 pt-1">
                        <AlertCircle className="w-3 h-3" />
                        <span>
                          {!canAfford
                            ? `Requires ${formatCurrency(hasCashReq!)}`
                            : `Requires at least ${hasEnergyReq}% energy`}
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleAction(act)}
                    disabled={isBlocked || activeActionId === act.id}
                    className={`py-2 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer ${
                      isBlocked
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md active:scale-95'
                    }`}
                  >
                    <span>{activeActionId === act.id ? 'Performing...' : 'Engage'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-between items-center text-xs">
          <span className="text-slate-500 font-mono text-[11px]">
            {isInterior ? 'Location Interior Scene' : 'Exterior Street Portal'}
          </span>
          <button
            onClick={onClose}
            className="py-1.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
