//! Tracks the most recent *foreign* foreground window so that autotype can be
//! triggered from within the Bitwarden window (e.g. an entry's context menu) and
//! still send keystrokes to the application the user was previously working in.
//!
//! When autotype is triggered via the global keyboard shortcut the target
//! application already owns the foreground, so this tracker is not involved. When
//! it is triggered from the Bitwarden UI, Bitwarden owns the foreground, so we
//! need to remember the window that was focused *before* Bitwarden and restore
//! focus to it before typing.
//!
//! A lightweight polling thread records the foreground window every
//! [`POLL_INTERVAL`]. Windows owned by Bitwarden's own process are skipped, so the
//! recorded handle is always the last application the user interacted with.

use std::{
    sync::{
        atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering},
        Mutex,
    },
    thread::JoinHandle,
    time::Duration,
};

use anyhow::{anyhow, Result};
use tracing::debug;
use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
        SetForegroundWindow, ShowWindow, SW_RESTORE,
    },
};

/// How often the polling thread samples the foreground window.
const POLL_INTERVAL: Duration = Duration::from_millis(200);

/// The last foreground window that did not belong to our own process, stored as
/// the raw `HWND` pointer value. `0` means "nothing recorded yet".
static LAST_FOREGROUND_HWND: AtomicIsize = AtomicIsize::new(0);

/// The pid of our own (Bitwarden) process. Windows owned by this process are never
/// recorded as the last foreground window.
static OWN_PID: AtomicU32 = AtomicU32::new(0);

/// Signals the polling thread to stop.
static STOP: AtomicBool = AtomicBool::new(false);

/// Handle to the running polling thread, if any.
static TRACKER_THREAD: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

/// Starts the foreground-tracking thread if it is not already running.
///
/// `own_pid` is the pid of the Bitwarden process; foreground windows owned by it
/// are ignored so we only ever record other applications.
pub(super) fn start_foreground_tracking(own_pid: u32) -> Result<()> {
    OWN_PID.store(own_pid, Ordering::SeqCst);

    let mut guard = TRACKER_THREAD
        .lock()
        .map_err(|_| anyhow!("Foreground tracker thread mutex was poisoned."))?;

    if guard.is_some() {
        debug!("Foreground tracking already running.");
        return Ok(());
    }

    STOP.store(false, Ordering::SeqCst);
    let handle = std::thread::Builder::new()
        .name("autotype-foreground-tracker".into())
        .spawn(tracking_loop)
        .map_err(|e| anyhow!("Failed to spawn foreground tracking thread: {e}"))?;

    *guard = Some(handle);
    debug!("Foreground tracking started.");
    Ok(())
}

/// Stops the foreground-tracking thread, blocking until it has exited.
pub(super) fn stop_foreground_tracking() -> Result<()> {
    STOP.store(true, Ordering::SeqCst);

    let handle = TRACKER_THREAD
        .lock()
        .map_err(|_| anyhow!("Foreground tracker thread mutex was poisoned."))?
        .take();

    if let Some(handle) = handle {
        let _ = handle.join();
        debug!("Foreground tracking stopped.");
    }

    Ok(())
}

/// Restores focus to the last recorded foreground window so that the subsequent
/// keystrokes land in the application the user was working in.
///
/// # Errors
///
/// Returns an error if no window has been recorded yet or if the recorded window
/// can no longer be brought to the foreground.
pub(super) fn focus_last_window() -> Result<()> {
    let raw = LAST_FOREGROUND_HWND.load(Ordering::SeqCst);
    if raw == 0 {
        return Err(anyhow!("No previous foreground window has been recorded."));
    }

    let hwnd = HWND(raw as *mut std::ffi::c_void);

    // SAFETY: We only pass a window handle we previously obtained from
    // `GetForegroundWindow`. If the window has since been destroyed the calls
    // below are no-ops and `SetForegroundWindow` reports failure, which we surface
    // as an error rather than typing into the wrong place.
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }

        let succeeded = SetForegroundWindow(hwnd).as_bool();
        let _ = BringWindowToTop(hwnd);

        if !succeeded {
            return Err(anyhow!(
                "Failed to bring the previous foreground window to the foreground."
            ));
        }
    }

    Ok(())
}

/// The polling loop body. Runs until [`STOP`] is set.
fn tracking_loop() {
    while !STOP.load(Ordering::SeqCst) {
        if let Some(hwnd_value) = current_foreign_foreground_window() {
            LAST_FOREGROUND_HWND.store(hwnd_value, Ordering::SeqCst);
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Returns the raw handle of the current foreground window if it is valid and does
/// not belong to our own process; otherwise `None`.
fn current_foreign_foreground_window() -> Option<isize> {
    // SAFETY: `GetForegroundWindow` and `GetWindowThreadProcessId` are always safe
    // to call; they only read process-global window state.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));

        let own_pid = OWN_PID.load(Ordering::SeqCst);
        if pid == 0 || pid == own_pid {
            return None;
        }

        Some(hwnd.0 as isize)
    }
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    use super::*;

    #[test]
    #[serial]
    fn focus_last_window_errors_when_nothing_recorded() {
        // Ensure a clean slate; other tests in this binary may have recorded a value.
        LAST_FOREGROUND_HWND.store(0, Ordering::SeqCst);

        let result = focus_last_window();
        assert!(result.is_err());
    }

    #[test]
    #[serial]
    fn start_is_idempotent_and_stop_clears_thread() {
        // Use the current process pid so the tracker never records a real window.
        let pid = std::process::id();
        start_foreground_tracking(pid).unwrap();
        // Second call should be a no-op rather than spawning a second thread.
        start_foreground_tracking(pid).unwrap();

        assert!(TRACKER_THREAD.lock().unwrap().is_some());

        stop_foreground_tracking().unwrap();
        assert!(TRACKER_THREAD.lock().unwrap().is_none());
    }
}
