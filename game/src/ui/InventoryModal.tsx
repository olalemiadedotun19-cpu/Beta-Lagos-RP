import React, { useState } from 'react';
import { InventoryItem, PlayerData } from '../types/game';
import { X, Package, Utensils, Coffee, Pill, Sparkles, Check, ChevronRight } from 'lucide-react';

interface InventoryModalProps {
  playerData: PlayerData;
  onUseItem: (item: InventoryItem) => void;
  onClose: () => void;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
  playerData,
  onUseItem,
  onClose,
}) => {
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(
    playerData.inventory[0] || null
  );
  const [justUsedMessage, setJustUsedMessage] = useState<string | null>(null);

  const getItemIcon = (category: string) => {
    switch (category) {
      case 'food':
        return <Utensils className="w-4 h-4 text-amber-400" />;
      case 'beverage':
        return <Coffee className="w-4 h-4 text-sky-400" />;
      case 'medicine':
        return <Pill className="w-4 h-4 text-rose-400" />;
      default:
        return <Package className="w-4 h-4 text-emerald-400" />;
    }
  };

  const handleConsume = (item: InventoryItem) => {
    onUseItem(item);
    setJustUsedMessage(`Used ${item.name}!`);
    setTimeout(() => setJustUsedMessage(null), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 select-none"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-700/60 flex items-center justify-center text-emerald-400">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Citizen Inventory</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {playerData.inventory.length} Items
                </span>
              </h2>
              <div className="text-[11px] text-slate-400">Personal belongings & provisions</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body: Split View */}
        <div className="flex-1 overflow-hidden flex flex-col sm:flex-row text-xs">
          {/* Items List */}
          <div className="w-full sm:w-[55%] border-b sm:border-b-0 sm:border-r border-slate-800 p-3 sm:p-4 overflow-y-auto space-y-2">
            {playerData.inventory.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>Your bag is currently empty.</p>
                <p className="text-[10px] mt-1 text-slate-600">
                  Purchase refreshments at Mama Put Buka or Ikeja City Mall.
                </p>
              </div>
            ) : (
              playerData.inventory.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    selectedItem?.id === item.id
                      ? 'bg-emerald-950/40 border-emerald-500/70 text-white'
                      : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/60 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                      {getItemIcon(item.category)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-100 truncate text-xs">{item.name}</div>
                      <div className="text-[10px] text-slate-400 capitalize">{item.category}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-emerald-400">
                      x{item.quantity}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Item Details Pane */}
          <div className="flex-1 p-4 sm:p-5 flex flex-col justify-between bg-slate-950/40">
            {selectedItem ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                    {getItemIcon(selectedItem.category)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{selectedItem.name}</h3>
                    <span className="text-[10px] text-slate-400 uppercase font-mono">
                      Category: {selectedItem.category}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                  {selectedItem.description}
                </p>

                {/* Effects Overview */}
                {selectedItem.effects && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Item Effects
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      {selectedItem.effects.hunger !== undefined && (
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 flex justify-between">
                          <span className="text-slate-400">Hunger</span>
                          <span className="font-mono font-bold text-emerald-400">
                            +{selectedItem.effects.hunger}%
                          </span>
                        </div>
                      )}
                      {selectedItem.effects.energy !== undefined && (
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 flex justify-between">
                          <span className="text-slate-400">Energy</span>
                          <span className="font-mono font-bold text-amber-400">
                            +{selectedItem.effects.energy}%
                          </span>
                        </div>
                      )}
                      {selectedItem.effects.health !== undefined && (
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 flex justify-between">
                          <span className="text-slate-400">Health</span>
                          <span className="font-mono font-bold text-rose-400">
                            +{selectedItem.effects.health}%
                          </span>
                        </div>
                      )}
                      {selectedItem.effects.happiness !== undefined && (
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 flex justify-between">
                          <span className="text-slate-400">Happiness</span>
                          <span className="font-mono font-bold text-emerald-400">
                            +{selectedItem.effects.happiness}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {justUsedMessage && (
                  <div className="p-2 bg-emerald-950/80 border border-emerald-500 rounded-lg text-emerald-300 text-center flex items-center justify-center gap-1.5 animate-bounce">
                    <Check className="w-3.5 h-3.5" />
                    <span>{justUsedMessage}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center my-auto text-slate-500">
                Select an item to view details
              </div>
            )}

            {selectedItem && (
              <button
                onClick={() => handleConsume(selectedItem)}
                className="w-full mt-4 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>Use / Consume Item</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
