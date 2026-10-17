declare const __UPDATE_URL__: string;

interface LauncherUpdate {
  kind: 'update';
  what: string;
  size: string;
  files: number;
  version: string;
  notes?: string;
  cellular: boolean;
  first: boolean;
  canSkip: boolean;
}
interface LauncherApi {
  /** Asks the server what changed. Throws "Failed to fetch" when nothing is installed and there is no connection. */
  check(): Promise<{ kind: 'play' } | LauncherUpdate>;
  download(onProgress: (p: { doneBytes: number; totalBytes: number; doneFiles: number; totalFiles: number }) => void): Promise<void>;
  launch(): Promise<void>;
  fmt(bytes: number): string;
}
interface Window {
  __LAUNCHER?: LauncherApi;
}
