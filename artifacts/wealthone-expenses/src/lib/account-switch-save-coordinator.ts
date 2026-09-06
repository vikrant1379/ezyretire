type SaveScope = object;

export type AccountSnapshot = {
  account: object | undefined;
  visibleData: unknown;
};

type SaveState = {
  latestSequence: number;
  pendingSaves: number;
  account: object | undefined;
  visibleData: unknown;
  accountSwitchNoticeClaimed: boolean;
};

const saveStatesByScope = new WeakMap<SaveScope, SaveState>();
const PENDING_LOGOUT_NOTICE_KEY = "ezyretire:pending-financial-change-logout";

export type AccountSwitchSave = {
  claimAccountSwitchNotice: () => boolean;
  finish: (current?: AccountSnapshot) => boolean;
  setVisibleData: (current: AccountSnapshot) => void;
};

export function beginAccountSwitchSave(
  scope: SaveScope,
  snapshot: AccountSnapshot,
  publishOrder: "completion" | "latest",
): AccountSwitchSave {
  const current = saveStatesByScope.get(scope);
  const continuesCurrentAccount =
    current !== undefined &&
    current.pendingSaves > 0 &&
    current.account === snapshot.account &&
    current.visibleData === snapshot.visibleData;
  const state: SaveState =
    continuesCurrentAccount && current
      ? current
      : {
          latestSequence: 0,
          pendingSaves: 0,
          account: snapshot.account,
          visibleData: snapshot.visibleData,
          accountSwitchNoticeClaimed: false,
        };
  state.latestSequence += 1;
  state.pendingSaves += 1;
  saveStatesByScope.set(scope, state);
  const sequence = state.latestSequence;

  let finished = false;
  let saveVisibleData = snapshot.visibleData;
  return {
    claimAccountSwitchNotice: () => {
      if (state.accountSwitchNoticeClaimed) {
        return false;
      }
      state.accountSwitchNoticeClaimed = true;
      return true;
    },
    setVisibleData: (visible) => {
      saveVisibleData = visible.visibleData;
      if (
        saveStatesByScope.get(scope) === state &&
        (publishOrder === "completion" || sequence === state.latestSequence)
      ) {
        state.account = visible.account;
        state.visibleData = visible.visibleData;
      }
    },
    finish: (
      visible = { account: state.account, visibleData: saveVisibleData },
    ) => {
      if (finished) {
        return false;
      }
      finished = true;

      const latestState = saveStatesByScope.get(scope);
      if (!latestState) {
        return false;
      }

      const isCurrentAccount = latestState === state;
      const mayPublish =
        isCurrentAccount &&
        visible.account === state.account &&
        visible.visibleData ===
          (publishOrder === "completion" ? state.visibleData : saveVisibleData) &&
        (publishOrder === "completion" ||
          sequence === latestState.latestSequence);
      if (!isCurrentAccount) {
        return false;
      }
      if (latestState.pendingSaves === 1) {
        latestState.pendingSaves = 0;
      } else {
        latestState.pendingSaves -= 1;
      }

      return mayPublish;
    },
  };
}

export function claimAccountSwitchSaveNotice(scope: SaveScope): boolean {
  const state = saveStatesByScope.get(scope);
  if (!state || state.accountSwitchNoticeClaimed) {
    return false;
  }
  state.accountSwitchNoticeClaimed = true;
  return true;
}

export function carryPendingSaveNoticeAcrossLogout(scope: SaveScope): boolean {
  const state = saveStatesByScope.get(scope);
  if (!state || state.pendingSaves === 0) {
    return false;
  }
  state.accountSwitchNoticeClaimed = true;
  try {
    window.sessionStorage.setItem(PENDING_LOGOUT_NOTICE_KEY, "1");
  } catch {
    // Logout must still invalidate the account generation when storage is blocked.
  }
  return true;
}

export function consumePendingSaveLogoutNotice(): boolean {
  try {
    if (window.sessionStorage.getItem(PENDING_LOGOUT_NOTICE_KEY) !== "1") {
      return false;
    }
    window.sessionStorage.removeItem(PENDING_LOGOUT_NOTICE_KEY);
    return true;
  } catch {
    return false;
  }
}