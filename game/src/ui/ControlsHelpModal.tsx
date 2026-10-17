import React from 'react';
import { X, Gamepad2, MousePointer, Sun, Navigation } from 'lucide-react';

interface ControlsHelpModalProps {
  onClose: () => void;
}

export const ControlsHelpModal: React.FC<ControlsHelpModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Gamepad2 className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Simulation Controls & Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-300 flex-1">
          {/* Locomotion & Camera */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5">
              <Navigation className="w-4 h-4 text-emerald-400" />
              <span>Locomotion & Camera Controls</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-emerald-400 font-mono font-bold">W / A / S / D</span> or Arrows
                <div className="text-[11px] text-slate-400 mt-0.5">Walk in 4 directions</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-emerald-400 font-mono font-bold">Left Shift</span>
                <div className="text-[11px] text-slate-400 mt-0.5">Sprint at high speed</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-emerald-400 font-mono font-bold">Spacebar</span>
                <div className="text-[11px] text-slate-400 mt-0.5">Jump over road curbs</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-emerald-400 font-mono font-bold">Key [E]</span>
                <div className="text-[11px] text-slate-400 mt-0.5">Interact with nearby building / POI</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-emerald-400 font-mono font-bold">Click + Drag</span>
                <div className="text-[11px] text-slate-400 mt-0.5">Orbit 3rd-person camera around player</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-emerald-400 font-mono font-bold">Mouse Wheel</span>
                <div className="text-[11px] text-slate-400 mt-0.5">Zoom camera in / out</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 col-span-2">
                <span className="text-emerald-400 font-mono font-bold">Touch</span>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Left thumb: floating joystick (appears where you touch). Right side: drag to look, pinch to zoom. Sprint toggles; double-tap Sprint to jump. ENTER / USE appears when a place is in range. Tap the minimap for the full map, the avatar for your profile, the bars to expand all needs.
                </div>
              </div>
            </div>
          </div>

          {/* Life Simulation Loop */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5">
              <Sun className="w-4 h-4 text-amber-400" />
              <span>How Life in Ikeja Works</span>
            </h3>
            <ul className="space-y-2 bg-slate-950 p-3.5 rounded-xl border border-slate-800/80 text-[11px] text-slate-300">
              <li>
                <strong className="text-slate-100">Day/Night & Time:</strong> The simulation clock advances naturally. Sunlight shifts dynamically, and nighttime illuminates street lamps along Awolowo Way and Allen Avenue.
              </li>
              <li>
                <strong className="text-slate-100">Needs Decay:</strong> As game hours pass, hunger and energy decrease. Work or sprinting depletes energy faster.
              </li>
              <li>
                <strong className="text-slate-100">Key Locations:</strong>
                <div className="mt-1 space-y-0.5 text-slate-400">
                  <div>· <strong>Home Residence</strong>: Sleep for 8 hours or take power naps to restore full energy.</div>
                  <div>· <strong>Mama Put's Buka</strong>: Enjoy hot firewood Jollof Rice or Suya to replenish hunger.</div>
                  <div>· <strong>Silicon Ikeja Tech Hub</strong>: Work coding gigs to earn money (₦25,000 per gig).</div>
                  <div>· <strong>Ikeja City Mall</strong>: Buy grocery packs, medical supplies, and window shop.</div>
                  <div>· <strong>Ikeja General Health Center</strong>: Medical treatments to restore health.</div>
                </div>
              </li>
              <li>
                <strong className="text-slate-100">Saving:</strong> Click the <strong>Save</strong> button in the top bar anytime. Your character appearance, position, date/time, and finances persist in local storage.
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="py-2 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Got it, Let's Play!
          </button>
        </div>
      </div>
    </div>
  );
};
