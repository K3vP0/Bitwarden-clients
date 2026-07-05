import { ipcMain, globalShortcut } from "electron";

import { autotype } from "@bitwarden/desktop-napi";
import { LogService } from "@bitwarden/logging";

import { WindowMain } from "../../main/window.main";
import { stringIsNotUndefinedNullAndEmpty } from "../../utils";
import { AutotypeConfig } from "../models/autotype-config";
import { AutotypeMatchError } from "../models/autotype-errors";
import { AutotypeVariant } from "../models/autotype-variant";
import { AutotypeVaultData } from "../models/autotype-vault-data";
import { AUTOTYPE_IPC_CHANNELS } from "../models/ipc-channels";
import { AutotypeKeyboardShortcut } from "../models/main-autotype-keyboard-shortcut";

/**
 * Delay between restoring focus to the previously active window and sending the
 * keystrokes, giving the target window time to settle into the foreground.
 */
const FOCUS_SETTLE_DELAY_MS = 100;

export class MainDesktopAutotypeService {
  private autotypeKeyboardShortcut: AutotypeKeyboardShortcut;

  constructor(
    private logService: LogService,
    private windowMain: WindowMain,
  ) {
    this.autotypeKeyboardShortcut = new AutotypeKeyboardShortcut();

    this.registerIpcListeners();

    // The context-menu autotype feature needs to know which window was focused
    // before Bitwarden took the foreground. Track it for the app's lifetime on
    // Windows. This is independent of the (premium/flag-gated) keyboard-shortcut
    // feature, and only stores a window handle — never vault data.
    if (process.platform === "win32") {
      try {
        autotype.startForegroundTracking(process.pid);
      } catch {
        this.logService.error("Failed to start autotype foreground tracking.");
      }
    }
  }

  registerIpcListeners() {
    ipcMain.on(AUTOTYPE_IPC_CHANNELS.TOGGLE, (_event, enable: boolean) => {
      if (enable) {
        this.enableAutotype();
      } else {
        this.disableAutotype();
      }
    });

    ipcMain.on(AUTOTYPE_IPC_CHANNELS.CONFIGURE, (_event, config: AutotypeConfig) => {
      const newKeyboardShortcut = new AutotypeKeyboardShortcut();
      const newKeyboardShortcutIsValid = newKeyboardShortcut.set(config.keyboardShortcut);

      if (!newKeyboardShortcutIsValid) {
        this.logService.error("Configure autotype failed: the keyboard shortcut is invalid.");
        return;
      }

      this.setKeyboardShortcut(newKeyboardShortcut);
    });

    ipcMain.on(AUTOTYPE_IPC_CHANNELS.EXECUTE, (_event, vaultData: AutotypeVaultData) => {
      if (
        stringIsNotUndefinedNullAndEmpty(vaultData.username) &&
        stringIsNotUndefinedNullAndEmpty(vaultData.password)
      ) {
        this.doAutotype(vaultData, this.autotypeKeyboardShortcut.getArrayFormat());
      }
    });

    ipcMain.on(
      AUTOTYPE_IPC_CHANNELS.EXECUTE_FOR_CIPHER,
      (_event, payload: { vaultData: AutotypeVaultData; variant: AutotypeVariant }) => {
        this.autotypeForCipher(payload.vaultData, payload.variant);
      },
    );

    ipcMain.on("autofill.completeAutotypeError", (_event, matchError: AutotypeMatchError) => {
      this.logService.debug(
        "autofill.completeAutotypeError",
        "No match for window: " + matchError.windowTitle,
      );
      this.logService.error("autofill.completeAutotypeError", matchError.errorMessage);
    });
  }

  // Deregister the keyboard shortcut if registered.
  disableAutotype() {
    const formattedKeyboardShortcut = this.autotypeKeyboardShortcut.getElectronFormat();

    if (globalShortcut.isRegistered(formattedKeyboardShortcut)) {
      globalShortcut.unregister(formattedKeyboardShortcut);
      this.logService.debug("Autotype disabled.");
    } else {
      this.logService.debug("Autotype is not registered, implicitly disabled.");
    }
  }

  dispose() {
    ipcMain.removeAllListeners(AUTOTYPE_IPC_CHANNELS.TOGGLE);
    ipcMain.removeAllListeners(AUTOTYPE_IPC_CHANNELS.CONFIGURE);
    ipcMain.removeAllListeners(AUTOTYPE_IPC_CHANNELS.EXECUTE);
    ipcMain.removeAllListeners(AUTOTYPE_IPC_CHANNELS.EXECUTE_FOR_CIPHER);

    if (process.platform === "win32") {
      try {
        autotype.stopForegroundTracking();
      } catch {
        this.logService.error("Failed to stop autotype foreground tracking.");
      }
    }

    // Also unregister the global shortcut
    this.disableAutotype();
  }

  // Register the current keyboard shortcut if not already registered.
  private enableAutotype() {
    const formattedKeyboardShortcut = this.autotypeKeyboardShortcut.getElectronFormat();
    if (globalShortcut.isRegistered(formattedKeyboardShortcut)) {
      this.logService.debug(
        "Autotype is already enabled with this keyboard shortcut: " + formattedKeyboardShortcut,
      );
      return;
    }

    const result = globalShortcut.register(
      this.autotypeKeyboardShortcut.getElectronFormat(),
      () => {
        const windowTitle = autotype.getForegroundWindowTitle();

        this.windowMain.win.webContents.send(AUTOTYPE_IPC_CHANNELS.LISTEN, {
          windowTitle,
        });
      },
    );

    result
      ? this.logService.debug("Autotype enabled.")
      : this.logService.error("Failed to enable Autotype.");
  }

  // Set the keyboard shortcut if it differs from the present one. If
  // the keyboard shortcut is set, de-register the old shortcut first.
  private setKeyboardShortcut(keyboardShortcut: AutotypeKeyboardShortcut) {
    if (
      keyboardShortcut.getElectronFormat() !== this.autotypeKeyboardShortcut.getElectronFormat()
    ) {
      const registered = globalShortcut.isRegistered(
        this.autotypeKeyboardShortcut.getElectronFormat(),
      );
      if (registered) {
        this.disableAutotype();
      }
      this.autotypeKeyboardShortcut = keyboardShortcut;
      if (registered) {
        this.enableAutotype();
      }
    } else {
      this.logService.debug(
        "setKeyboardShortcut() called but shortcut is not different from current.",
      );
    }
  }

  private doAutotype(vaultData: AutotypeVaultData, keyboardShortcut: string[]) {
    const TAB = "\t";
    const inputPattern = vaultData.username + TAB + vaultData.password;

    autotype.typeInput(toCharCodes(inputPattern), keyboardShortcut);
  }

  // Triggered from a vault item (e.g. its context menu). Unlike the global
  // keyboard shortcut flow, Bitwarden owns the foreground here, so focus is first
  // restored to the previously active window before typing.
  private autotypeForCipher(vaultData: AutotypeVaultData, variant: AutotypeVariant) {
    // Autotype is only supported on Windows; the native tracking/focus calls are
    // not implemented elsewhere. The renderer already gates this, but guard here
    // too as defense in depth.
    if (process.platform !== "win32") {
      return;
    }

    const inputPattern = buildAutotypeInput(vaultData, variant);
    if (inputPattern == null) {
      return;
    }

    try {
      autotype.focusLastWindow();
    } catch {
      this.logService.error("Autotype failed: could not focus the previous window.");
      return;
    }

    // Give the target window a moment to settle into the foreground before typing.
    setTimeout(() => {
      try {
        // No modifier keys are held when triggered from the UI, so no keyboard
        // shortcut keys need to be released first.
        autotype.typeInput(toCharCodes(inputPattern), []);
      } catch {
        this.logService.error("Autotype failed: could not type into the target window.");
      }
    }, FOCUS_SETTLE_DELAY_MS);
  }
}

/**
 * Builds the string to type for the given vault data and variant, or `null` when
 * the required fields are not present.
 */
function buildAutotypeInput(vaultData: AutotypeVaultData, variant: AutotypeVariant): string | null {
  const TAB = "\t";

  switch (variant) {
    case AutotypeVariant.UsernamePassword:
      if (
        !stringIsNotUndefinedNullAndEmpty(vaultData.username) ||
        !stringIsNotUndefinedNullAndEmpty(vaultData.password)
      ) {
        return null;
      }
      return vaultData.username + TAB + vaultData.password;
    case AutotypeVariant.Password:
      if (!stringIsNotUndefinedNullAndEmpty(vaultData.password)) {
        return null;
      }
      return vaultData.password;
    default:
      return null;
  }
}

/** Converts a string into the array of UTF-16 char codes expected by the native autotype API. */
function toCharCodes(input: string): number[] {
  const charCodes = new Array<number>(input.length);
  for (let i = 0; i < input.length; i++) {
    charCodes[i] = input.charCodeAt(i);
  }
  return charCodes;
}
