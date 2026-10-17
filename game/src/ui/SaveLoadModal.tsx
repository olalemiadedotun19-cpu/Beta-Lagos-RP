import React, { useEffect, useState } from 'react';
import { SaveMetadata } from '../types/game';
import { globalSaveManager } from '../save/SaveManager';
import { X, Save, FolderOpen, Trash2, PlusCircle, Clock, User } from 'lucide-react';

interface SaveLoadModalProps {
  onLoadSave: (slotId: string) => void;
  onSaveCurrent: (slotId: string) => void;
  onNewLife: () => void;
  onClose: () => void;
}

export const SaveLoadModal: React.FC<SaveLoadModalProps> = ({
  onLoadSave,
  onSaveCurrent,
  onNewLife,
  onClose,
}) => {
  const [saves, setSaves] = useState<SaveMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSaves = async () => {
    setIsLoading(true);
    const list = await globalSaveManager.listSaves();
    setSaves(list);
    setIsLoading(false);
  };

  useEffect(() => {
    refreshSaves();
  }, []);

  const handleDelete = async (slotId: string) => {
    if (confirm('Are you sure you want to delete this saved life?')) {
      await globalSaveManager.deleteSave(slotId);
      refreshSaves();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Save & Load Manager</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
              Saved Timelines (Local Storage)
            </span>
            <button
              onClick={() => {
                const nextSlot = `slot_${Date.now()}`;
                onSaveCurrent(nextSlot);
                refreshSaves();
              }}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save to New Slot</span>
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-400">Loading saved lives...</div>
          ) : saves.length === 0 ? (
            <div className="text-center py-8 bg-slate-950 rounded-xl border border-dashed border-slate-800 p-6">
              <User className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-400">No saved lives found yet.</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Save your current life in Ikeja or start a new character.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {saves.map((save) => {
                const formattedDate = new Date(save.lastSavedAt).toLocaleString();
                return (
                  <div
                    key={save.id}
                    className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-sm text-white flex items-center gap-2">
                        <span>{save.playerName || 'Citizen'}</span>
                        {save.username && (
                          <span className="text-xs font-mono text-emerald-400 font-normal">
                            @{save.username}
                          </span>
                        )}
                        <span className="text-xs font-normal text-slate-400">· Age {save.age}</span>
                      </div>
                      <div className="text-xs text-emerald-400 font-medium mt-0.5">
                        {save.locationName}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        <span>Saved: {formattedDate}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => onLoadSave(save.id)}
                        className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => {
                          onSaveCurrent(save.id);
                          refreshSaves();
                        }}
                        className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Overwrite
                      </button>
                      <button
                        onClick={() => handleDelete(save.id)}
                        title="Delete Save"
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={onNewLife}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 text-emerald-400" />
            <span>Create New Character</span>
          </button>
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
