import { useState, useEffect } from 'react';
import { OrientationMode } from '../types/game';

export interface OrientationInfo {
  width: number;
  height: number;
  aspectRatio: number;
  isPortrait: boolean;
  isMobileDevice: boolean;
  preference: OrientationMode;
  setPreference: (mode: OrientationMode) => void;
  // Effective orientation taking preference into account
  effectiveIsPortrait: boolean;
}

export function useOrientation(): OrientationInfo {
  const [preference, setPreference] = useState<OrientationMode>('auto');
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720,
  });

  const [isMobileDevice, setIsMobileDevice] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    const checkMobile = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isCoarse = window.matchMedia('(pointer: coarse)').matches;
      setIsMobileDevice(hasTouch || isCoarse);
    };

    checkMobile();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const naturalIsPortrait = windowSize.height > windowSize.width;

  const effectiveIsPortrait =
    preference === 'portrait'
      ? true
      : preference === 'landscape'
      ? false
      : naturalIsPortrait;

  return {
    width: windowSize.width,
    height: windowSize.height,
    aspectRatio: windowSize.width / (windowSize.height || 1),
    isPortrait: naturalIsPortrait,
    isMobileDevice,
    preference,
    setPreference,
    effectiveIsPortrait,
  };
}
