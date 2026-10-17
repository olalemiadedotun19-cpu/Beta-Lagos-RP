import React, { useCallback, useEffect, useState } from 'react';
import type { PlayerData } from '../../types/game';
import { accountSlot, type Account } from '../../auth/AccountStore';
import { getRememberedAccount, rememberAccount, signOutAccount } from '../../net/cloudAuth';
import { createNewPlayer } from '../../auth/newPlayer';
import { withOwnerGrant } from '../../auth/owner';
import { globalSaveManager } from '../../save/SaveManager';
import { sanitizeOutfit, type Outfit } from '../../wardrobe/Wardrobe';
import { DEFAULT_SPAWN_POINT, isSpawnAvailable, type SpawnPointId } from '../../spawn/SpawnPoints';
import { SignInScreen } from './SignInScreen';
import { Showroom } from './Showroom';
import { SpawnPicker } from './SpawnPicker';
import './entry.css';

interface EntryFlowProps {
  /** the player pressed START: their data (with the chosen outfit and spawn point) and the save slot of their account */
  onComplete: (data: PlayerData, slotId: string) => void;
  /** "new life" from inside the game: the account's old progress is not loaded, START GAME replaces it */
  freshStart?: boolean;
  /** only given for "new life": a way back to the game that is still running behind */
  onCancel?: () => void;
}

type Stage =
  | { kind: 'checking' }
  | { kind: 'signin' }
  | { kind: 'showroom'; account: Account; data: PlayerData; note?: string }
  | { kind: 'spawn'; account: Account; data: PlayerData };

/**
 * The entry flow:
 *   1. SIGN IN button, then the login form (name / username / password). Only the very first time on a device: after that the device
 *      remembers the account and goes straight on (Firebase keeps the session, see net/cloudAuth.ts). Signing out brings the form back.
 *      The account and its save live in the cloud (Firebase) when it is configured, on this device otherwise.
 *   2. the clothing showroom (new citizens, or an account that never got as far as starting the game)
 *   3. where to start (spawn point picker); a returning citizen lands here directly with their saved character
 *   4. START hands the player (wearing the chosen outfit) to the game
 * Every account owns one save slot: signing in again brings back its progress, a new username starts a new citizen.
 */
export const EntryFlow: React.FC<EntryFlowProps> = ({ onComplete, freshStart = false, onCancel }) => {
  const [stage, setStage] = useState<Stage>(freshStart ? { kind: 'signin' } : { kind: 'checking' });

  // a returning citizen: no sign-in, no account form, no showroom: straight to "where to start"
  useEffect(() => {
    if (stage.kind !== 'checking') return;
    let cancelled = false;
    void (async () => {
      const account = await getRememberedAccount().catch(() => null);
      if (!account) {
        if (!cancelled) setStage({ kind: 'signin' });
        return;
      }
      const slot = accountSlot(account.username);
      const saved = await globalSaveManager.load(slot).catch(() => null);
      if (cancelled) return;
      globalSaveManager.setCurrentSlotId(slot);
      setStage(saved ? { kind: 'spawn', account, data: withOwnerGrant(account, saved) } : { kind: 'showroom', account, data: withOwnerGrant(account, createNewPlayer(account)) });
    })();
    return () => {
      cancelled = true;
    };
  }, [stage.kind]);

  const signedIn = useCallback(
    async (account: Account, isNew: boolean) => {
      rememberAccount(account);
      const slot = accountSlot(account.username);
      let data: PlayerData | null = null;
      if (!freshStart) {
        data = await globalSaveManager.load(slot);
        if (!data && isNew) {
          // a citizen saved before accounts existed, with this same username, is adopted by the new account
          const legacy = await globalSaveManager.getLatestSave();
          if (legacy && legacy.data.identity?.username === account.username) data = legacy.data;
        }
      }
      globalSaveManager.setCurrentSlotId(slot);
      setStage({
        kind: 'showroom',
        account,
        data: withOwnerGrant(account, data ?? createNewPlayer(account)),
        note: freshStart && !isNew ? `A new life replaces the saved progress of @${account.username}` : undefined,
      });
    },
    [freshStart]
  );

  const signOut = (): void => {
    void signOutAccount()
      .catch(() => {})
      .finally(() => setStage({ kind: 'signin' }));
  };

  if (stage.kind === 'checking') return <div className="ef-root" style={{ background: '#07090c' }} aria-busy="true" />;

  if (stage.kind === 'signin') return <SignInScreen onSignedIn={signedIn} onCancel={onCancel} />;

  if (stage.kind === 'spawn') {
    const { account, data } = stage;
    return (
      <SpawnPicker
        key={account.username}
        account={account}
        initial={data.spawnPoint}
        hasLastLocation={!!data.hasPlayed}
        onStart={(spawn: SpawnPointId) =>
          onComplete(
            {
              ...data,
              outfit: sanitizeOutfit(data.outfit),
              spawnPoint: isSpawnAvailable(spawn) ? spawn : DEFAULT_SPAWN_POINT,
            },
            accountSlot(account.username)
          )
        }
        onSignOut={signOut}
      />
    );
  }

  // the showroom's START GAME moves on to "where to start" (the showroom closes, handing the prepared character back to the game)
  const toSpawn = (outfit: Outfit): void => {
    setStage({ kind: 'spawn', account: stage.account, data: { ...stage.data, outfit: sanitizeOutfit(outfit) } });
  };

  return (
    <Showroom
      key={stage.account.username}
      account={stage.account}
      initialOutfit={stage.data.outfit}
      note={stage.note}
      onStart={toSpawn}
      onSignOut={signOut}
    />
  );
};
