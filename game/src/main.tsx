import {createRoot} from 'react-dom/client';
import LaunchGate from './launch/LaunchGate.tsx';
import './index.css';
import { installAutoFullscreen } from './utils/fullscreen';

installAutoFullscreen();

// The launch sequence plays first; the game (App) is loaded and mounted by LaunchGate once the loading bar completes.
createRoot(document.getElementById('root')!).render(<LaunchGate />);
