use anyhow::Result;
use itertools::Itertools;
use tracing::debug;
use windows::Win32::{
    Foundation::{GetLastError, SetLastError, WIN32_ERROR},
    UI::Input::KeyboardAndMouse::INPUT,
};

mod foreground_tracker;
mod type_input;
mod window_title;

/// The error code from Win32 API that represents a non-error.
const WIN32_SUCCESS: WIN32_ERROR = WIN32_ERROR(0);

/// `ErrorOperations` provides an interface to the Win32 API for dealing with
/// win32 errors.
#[cfg_attr(test, mockall::automock)]
trait ErrorOperations {
    /// <https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-setlasterror>
    fn set_last_error(err: u32) {
        debug!(err, "Calling SetLastError");
        unsafe {
            SetLastError(WIN32_ERROR(err));
        }
    }

    /// <https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror>
    fn get_last_error() -> WIN32_ERROR {
        let last_err = unsafe { GetLastError() };
        debug!("GetLastError(): {}", last_err.to_hresult().message());
        last_err
    }
}

/// Default implementation for Win32 API errors.
struct Win32ErrorOperations;
impl ErrorOperations for Win32ErrorOperations {}

pub fn get_foreground_window_title() -> Result<String> {
    window_title::get_foreground_window_title()
}

pub fn start_foreground_tracking(own_pid: u32) -> Result<()> {
    foreground_tracker::start_foreground_tracking(own_pid)
}

pub fn stop_foreground_tracking() -> Result<()> {
    foreground_tracker::stop_foreground_tracking()
}

pub fn focus_last_window() -> Result<()> {
    foreground_tracker::focus_last_window()
}

/// `KeyboardShortcutInput` is an `INPUT` of one of the valid shortcut keys:
///     - Control
///     - Alt
///     - Super
///     - \[a-z\]\[A-Z\]
struct KeyboardShortcutInput(INPUT);

pub fn type_input(input: &[u16], keyboard_shortcut: &[String]) -> Result<()> {
    debug!(?keyboard_shortcut, "type_input() called.");

    // convert the raw string input to Windows input and error
    // if any key is not a valid keyboard shortcut input
    let keyboard_shortcut: Vec<KeyboardShortcutInput> = keyboard_shortcut
        .iter()
        .map(|s| KeyboardShortcutInput::try_from(s.as_str()))
        .try_collect()?;

    type_input::type_input(input, &keyboard_shortcut)
}
