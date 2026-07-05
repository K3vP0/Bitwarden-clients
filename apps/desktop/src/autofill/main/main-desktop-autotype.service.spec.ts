/* eslint-disable @typescript-eslint/no-unsafe-function-type */

import { TestBed } from "@angular/core/testing";
import { ipcMain, globalShortcut } from "electron";

import { autotype } from "@bitwarden/desktop-napi";
import { LogService } from "@bitwarden/logging";

import { WindowMain } from "../../main/window.main";
import { AutotypeConfig } from "../models/autotype-config";
import { AutotypeMatchError } from "../models/autotype-errors";
import { AutotypeVariant } from "../models/autotype-variant";
import { AutotypeVaultData } from "../models/autotype-vault-data";
import { AUTOTYPE_IPC_CHANNELS } from "../models/ipc-channels";
import { AutotypeKeyboardShortcut } from "../models/main-autotype-keyboard-shortcut";

import { MainDesktopAutotypeService } from "./main-desktop-autotype.service";

// Mock electron modules
jest.mock("electron", () => ({
  ipcMain: {
    on: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  globalShortcut: {
    register: jest.fn(),
    unregister: jest.fn(),
    isRegistered: jest.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: jest.fn(),
  },
}));

// Mock desktop-napi
jest.mock("@bitwarden/desktop-napi", () => ({
  autotype: {
    getForegroundWindowTitle: jest.fn(),
    typeInput: jest.fn(),
    startForegroundTracking: jest.fn(),
    stopForegroundTracking: jest.fn(),
    focusLastWindow: jest.fn(),
  },
}));

// Mock AutotypeKeyboardShortcut
jest.mock("../models/main-autotype-keyboard-shortcut", () => ({
  AutotypeKeyboardShortcut: jest.fn().mockImplementation(() => ({
    set: jest.fn().mockReturnValue(true),
    getElectronFormat: jest.fn().mockReturnValue("Control+Alt+B"),
    getArrayFormat: jest.fn().mockReturnValue(["Control", "Alt", "B"]),
  })),
}));

describe("MainDesktopAutotypeService", () => {
  let service: MainDesktopAutotypeService;
  let mockLogService: jest.Mocked<LogService>;
  let mockWindowMain: jest.Mocked<WindowMain>;
  let ipcHandlers: Map<string, Function>;

  beforeEach(() => {
    // Track IPC handlers
    ipcHandlers = new Map();
    (ipcMain.on as jest.Mock).mockImplementation((channel: string, handler: Function) => {
      ipcHandlers.set(channel, handler);
    });

    // Mock LogService
    mockLogService = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
    } as any;

    // Mock WindowMain with webContents
    mockWindowMain = {
      win: {
        webContents: {
          send: jest.fn(),
        },
      },
    } as any;

    // Reset all mocks
    jest.clearAllMocks();
    (globalShortcut.isRegistered as jest.Mock).mockReturnValue(false);
    (globalShortcut.register as jest.Mock).mockReturnValue(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: LogService, useValue: mockLogService },
        { provide: WindowMain, useValue: mockWindowMain },
      ],
    });

    // Create service manually since it doesn't use Angular DI
    service = new MainDesktopAutotypeService(mockLogService, mockWindowMain);
  });

  afterEach(() => {
    ipcHandlers.clear(); // Clear handler map
    service.dispose();
  });

  describe("constructor", () => {
    it("should create service", () => {
      expect(service).toBeTruthy();
    });

    it("should initialize keyboard shortcut", () => {
      expect(service.autotypeKeyboardShortcut).toBeDefined();
    });

    it("should register IPC handlers", () => {
      expect(ipcMain.on).toHaveBeenCalledWith(AUTOTYPE_IPC_CHANNELS.TOGGLE, expect.any(Function));
      expect(ipcMain.on).toHaveBeenCalledWith(
        AUTOTYPE_IPC_CHANNELS.CONFIGURE,
        expect.any(Function),
      );
      expect(ipcMain.on).toHaveBeenCalledWith(AUTOTYPE_IPC_CHANNELS.EXECUTE, expect.any(Function));
      expect(ipcMain.on).toHaveBeenCalledWith(
        "autofill.completeAutotypeError",
        expect.any(Function),
      );
    });
  });

  describe("TOGGLE handler", () => {
    it("should enable autotype when toggle is true", () => {
      const toggleHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.TOGGLE);

      toggleHandler({}, true);

      expect(globalShortcut.register).toHaveBeenCalled();
      expect(mockLogService.debug).toHaveBeenCalledWith("Autotype enabled.");
    });

    it("should disable autotype when toggle is false", () => {
      (globalShortcut.isRegistered as jest.Mock).mockReturnValue(true);
      const toggleHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.TOGGLE);

      toggleHandler({}, false);

      expect(globalShortcut.unregister).toHaveBeenCalled();
      expect(mockLogService.debug).toHaveBeenCalledWith("Autotype disabled.");
    });
  });

  describe("CONFIGURE handler", () => {
    it("should update keyboard shortcut with valid configuration", () => {
      const config: AutotypeConfig = {
        keyboardShortcut: ["Control", "Alt", "A"],
      };

      const mockNewShortcut = {
        set: jest.fn().mockReturnValue(true),
        getElectronFormat: jest.fn().mockReturnValue("Control+Alt+A"),
        getArrayFormat: jest.fn().mockReturnValue(["Control", "Alt", "A"]),
      };
      (AutotypeKeyboardShortcut as jest.Mock).mockReturnValue(mockNewShortcut);

      const configureHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.CONFIGURE);
      configureHandler({}, config);

      expect(mockNewShortcut.set).toHaveBeenCalledWith(config.keyboardShortcut);
    });

    it("should log error with invalid keyboard shortcut", () => {
      const config: AutotypeConfig = {
        keyboardShortcut: ["Invalid", "Keys"],
      };

      const mockNewShortcut = {
        set: jest.fn().mockReturnValue(false),
        getElectronFormat: jest.fn(),
        getArrayFormat: jest.fn(),
      };
      (AutotypeKeyboardShortcut as jest.Mock).mockReturnValue(mockNewShortcut);

      const configureHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.CONFIGURE);
      configureHandler({}, config);

      expect(mockLogService.error).toHaveBeenCalledWith(
        "Configure autotype failed: the keyboard shortcut is invalid.",
      );
    });

    it("should register new shortcut if one already registered", () => {
      (globalShortcut.isRegistered as jest.Mock)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const config: AutotypeConfig = {
        keyboardShortcut: ["Control", "Alt", "B"],
      };

      const mockNewShortcut = {
        set: jest.fn().mockReturnValue(true),
        getElectronFormat: jest.fn().mockReturnValue("Control+Alt+B"),
        getArrayFormat: jest.fn().mockReturnValue(["Control", "Alt", "B"]),
      };
      (AutotypeKeyboardShortcut as jest.Mock).mockReturnValue(mockNewShortcut);

      const configureHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.CONFIGURE);
      configureHandler({}, config);

      expect(globalShortcut.unregister).toHaveBeenCalled();
      expect(globalShortcut.register).toHaveBeenCalled();
    });

    it("should not change shortcut if it is the same", () => {
      const config: AutotypeConfig = {
        keyboardShortcut: ["Control", "Alt", "B"],
      };

      jest
        .spyOn(service.autotypeKeyboardShortcut, "getElectronFormat")
        .mockReturnValue("Control+Alt+B");

      (globalShortcut.isRegistered as jest.Mock).mockReturnValue(true);

      const configureHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.CONFIGURE);
      configureHandler({}, config);

      expect(mockLogService.debug).toHaveBeenCalledWith(
        "setKeyboardShortcut() called but shortcut is not different from current.",
      );
    });
  });

  describe("EXECUTE handler", () => {
    it("should execute autotype with valid vault data", async () => {
      const vaultData: AutotypeVaultData = {
        username: "testuser",
        password: "testpass",
      };

      jest
        .spyOn(service.autotypeKeyboardShortcut, "getArrayFormat")
        .mockReturnValue(["Control", "Alt", "B"]);

      const executeHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.EXECUTE);
      await executeHandler({}, vaultData);

      expect(autotype.typeInput).toHaveBeenCalledWith(expect.any(Array), ["Control", "Alt", "B"]);
    });

    it("should not execute autotype with empty username", () => {
      const vaultData: AutotypeVaultData = {
        username: "",
        password: "testpass",
      };

      const executeHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.EXECUTE);
      executeHandler({}, vaultData);

      expect(autotype.typeInput).not.toHaveBeenCalled();
    });

    it("should not execute autotype with empty password", () => {
      const vaultData: AutotypeVaultData = {
        username: "testuser",
        password: "",
      };

      const executeHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.EXECUTE);
      executeHandler({}, vaultData);

      expect(autotype.typeInput).not.toHaveBeenCalled();
    });

    it("should format input with tab separator", () => {
      const mockNewShortcut = {
        set: jest.fn().mockReturnValue(true),
        getElectronFormat: jest.fn().mockReturnValue("Control+Alt+B"),
        getArrayFormat: jest.fn().mockReturnValue(["Control", "Alt", "B"]),
      };

      (AutotypeKeyboardShortcut as jest.Mock).mockReturnValue(mockNewShortcut);

      const vaultData: AutotypeVaultData = {
        username: "user",
        password: "pass",
      };

      const executeHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.EXECUTE);
      executeHandler({}, vaultData);

      // Verify the input array contains char codes for "user\tpass"
      const expectedPattern = "user\tpass";
      const expectedArray = Array.from(expectedPattern).map((c) => c.charCodeAt(0));

      expect(autotype.typeInput).toHaveBeenCalledWith(expectedArray, ["Control", "Alt", "B"]);
    });
  });

  describe("completeAutotypeError handler", () => {
    it("should log autotype match errors", () => {
      const matchError: AutotypeMatchError = {
        windowTitle: "Test Window",
        errorMessage: "No matching vault item",
      };

      const errorHandler = ipcHandlers.get("autofill.completeAutotypeError");
      errorHandler({}, matchError);

      expect(mockLogService.debug).toHaveBeenCalledWith(
        "autofill.completeAutotypeError",
        "No match for window: Test Window",
      );
      expect(mockLogService.error).toHaveBeenCalledWith(
        "autofill.completeAutotypeError",
        "No matching vault item",
      );
    });
  });

  describe("disableAutotype", () => {
    it("should unregister shortcut if registered", () => {
      (globalShortcut.isRegistered as jest.Mock).mockReturnValue(true);

      service.disableAutotype();

      expect(globalShortcut.unregister).toHaveBeenCalled();
      expect(mockLogService.debug).toHaveBeenCalledWith("Autotype disabled.");
    });

    it("should log debug message if shortcut not registered", () => {
      (globalShortcut.isRegistered as jest.Mock).mockReturnValue(false);

      service.disableAutotype();

      expect(globalShortcut.unregister).not.toHaveBeenCalled();
      expect(mockLogService.debug).toHaveBeenCalledWith(
        "Autotype is not registered, implicitly disabled.",
      );
    });
  });

  describe("dispose", () => {
    it("should remove all IPC listeners", () => {
      service.dispose();

      expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(AUTOTYPE_IPC_CHANNELS.TOGGLE);
      expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(AUTOTYPE_IPC_CHANNELS.CONFIGURE);
      expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(AUTOTYPE_IPC_CHANNELS.EXECUTE);
    });

    it("should disable autotype", () => {
      (globalShortcut.isRegistered as jest.Mock).mockReturnValue(true);

      service.dispose();

      expect(globalShortcut.unregister).toHaveBeenCalled();
    });
  });

  describe("enableAutotype (via TOGGLE handler)", () => {
    it("should register global shortcut", () => {
      const toggleHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.TOGGLE);

      toggleHandler({}, true);

      expect(globalShortcut.register).toHaveBeenCalledWith("Control+Alt+B", expect.any(Function));
    });

    it("should not register if already registered", () => {
      (globalShortcut.isRegistered as jest.Mock).mockReturnValue(true);
      const toggleHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.TOGGLE);

      toggleHandler({}, true);

      expect(globalShortcut.register).not.toHaveBeenCalled();
      expect(mockLogService.debug).toHaveBeenCalledWith(
        "Autotype is already enabled with this keyboard shortcut: Control+Alt+B",
      );
    });

    it("should log error if registration fails", () => {
      (globalShortcut.register as jest.Mock).mockReturnValue(false);
      const toggleHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.TOGGLE);

      toggleHandler({}, true);

      expect(mockLogService.error).toHaveBeenCalledWith("Failed to enable Autotype.");
    });

    it("should send window title to renderer on shortcut activation", () => {
      (autotype.getForegroundWindowTitle as jest.Mock).mockReturnValue("Notepad");

      const toggleHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.TOGGLE);
      toggleHandler({}, true);

      // Get the registered callback
      const registeredCallback = (globalShortcut.register as jest.Mock).mock.calls[0][1];
      registeredCallback();

      expect(autotype.getForegroundWindowTitle).toHaveBeenCalled();
      expect(mockWindowMain.win.webContents.send).toHaveBeenCalledWith(
        AUTOTYPE_IPC_CHANNELS.LISTEN,
        { windowTitle: "Notepad" },
      );
    });
  });

  describe("EXECUTE_FOR_CIPHER handler", () => {
    const originalPlatform = process.platform;

    const setPlatform = (platform: NodeJS.Platform) => {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("should register the EXECUTE_FOR_CIPHER IPC handler", () => {
      expect(ipcMain.on).toHaveBeenCalledWith(
        AUTOTYPE_IPC_CHANNELS.EXECUTE_FOR_CIPHER,
        expect.any(Function),
      );
    });

    it("should focus the previous window then type username + tab + password on Windows", () => {
      setPlatform("win32");
      const vaultData: AutotypeVaultData = { username: "user", password: "pass" };

      const handler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.EXECUTE_FOR_CIPHER);
      handler({}, { vaultData, variant: AutotypeVariant.UsernamePassword });

      expect(autotype.focusLastWindow).toHaveBeenCalled();
      // Typing is deferred until the target window has settled into the foreground.
      expect(autotype.typeInput).not.toHaveBeenCalled();

      jest.advanceTimersByTime(200);

      const expectedArray = Array.from("user\tpass").map((c) => c.charCodeAt(0));
      expect(autotype.typeInput).toHaveBeenCalledWith(expectedArray, []);
    });

    it("should type only the password for the password variant", () => {
      setPlatform("win32");
      const vaultData: AutotypeVaultData = { username: "user", password: "pass" };

      const handler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.EXECUTE_FOR_CIPHER);
      handler({}, { vaultData, variant: AutotypeVariant.Password });

      jest.advanceTimersByTime(200);

      const expectedArray = Array.from("pass").map((c) => c.charCodeAt(0));
      expect(autotype.typeInput).toHaveBeenCalledWith(expectedArray, []);
    });

    it("should do nothing when not on Windows", () => {
      setPlatform("linux");
      const vaultData: AutotypeVaultData = { username: "user", password: "pass" };

      const handler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.EXECUTE_FOR_CIPHER);
      handler({}, { vaultData, variant: AutotypeVariant.UsernamePassword });

      jest.advanceTimersByTime(200);

      expect(autotype.focusLastWindow).not.toHaveBeenCalled();
      expect(autotype.typeInput).not.toHaveBeenCalled();
    });

    it("should not type if focusing the previous window fails", () => {
      setPlatform("win32");
      (autotype.focusLastWindow as jest.Mock).mockImplementationOnce(() => {
        throw new Error("no window");
      });
      const vaultData: AutotypeVaultData = { username: "user", password: "pass" };

      const handler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.EXECUTE_FOR_CIPHER);
      handler({}, { vaultData, variant: AutotypeVariant.UsernamePassword });

      jest.advanceTimersByTime(200);

      expect(autotype.typeInput).not.toHaveBeenCalled();
    });
  });

  describe("foreground tracking lifecycle", () => {
    const originalPlatform = process.platform;

    const setPlatform = (platform: NodeJS.Platform) => {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
    };

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("should start tracking on construction on Windows", () => {
      setPlatform("win32");
      jest.clearAllMocks();

      const winService = new MainDesktopAutotypeService(mockLogService, mockWindowMain);

      expect(autotype.startForegroundTracking).toHaveBeenCalledWith(process.pid);
      winService.dispose();
    });

    it("should not start tracking on construction on non-Windows", () => {
      setPlatform("linux");
      jest.clearAllMocks();

      const linuxService = new MainDesktopAutotypeService(mockLogService, mockWindowMain);

      expect(autotype.startForegroundTracking).not.toHaveBeenCalled();
      linuxService.dispose();
    });

    it("should stop tracking on dispose on Windows", () => {
      setPlatform("win32");
      const winService = new MainDesktopAutotypeService(mockLogService, mockWindowMain);
      jest.clearAllMocks();

      winService.dispose();

      expect(autotype.stopForegroundTracking).toHaveBeenCalled();
    });

    it("should not toggle tracking with the keyboard-shortcut feature", () => {
      jest.clearAllMocks();
      const toggleHandler = ipcHandlers.get(AUTOTYPE_IPC_CHANNELS.TOGGLE);

      toggleHandler({}, true);
      toggleHandler({}, false);

      expect(autotype.startForegroundTracking).not.toHaveBeenCalled();
      expect(autotype.stopForegroundTracking).not.toHaveBeenCalled();
    });
  });
});
