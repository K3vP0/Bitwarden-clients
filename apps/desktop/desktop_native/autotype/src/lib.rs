use anyhow::Result;

#[cfg(target_os = "windows")]
mod modifier_keys;

#[cfg(target_os = "windows")]
pub(crate) use modifier_keys::*;

#[cfg_attr(target_os = "linux", path = "linux.rs")]
#[cfg_attr(target_os = "macos", path = "macos.rs")]
#[cfg_attr(target_os = "windows", path = "windows/mod.rs")]
mod windowing;

/// Gets the title bar string for the foreground window.
///
/// # Errors
///
/// This function returns an `anyhow::Error` if there is any
/// issue obtaining the window title. Detailed reasons will
/// vary based on platform implementation.
pub fn get_foreground_window_title() -> Result<String> {
    windowing::get_foreground_window_title()
}

/// Attempts to type the input text wherever the user's cursor is.
///
/// # Arguments
///
/// * `input` an array of utf-16 encoded characters to insert.
/// * `keyboard_shortcut` a vector of valid shortcut keys: Control, Alt, Super, Shift, letters a - Z
///
/// # Errors
///
/// This function returns an `anyhow::Error` if there is any
/// issue in typing the input. Detailed reasons will
/// vary based on platform implementation.
pub fn type_input(input: &[u16], keyboard_shortcut: &[String]) -> Result<()> {
    windowing::type_input(input, keyboard_shortcut)
}

/// Starts tracking the most recent foreground window that does not belong to the
/// calling (Bitwarden) process.
///
/// This enables triggering autotype from within the Bitwarden window (for example
/// an entry's context menu): the previously focused application is remembered so
/// that focus can be restored to it before typing.
///
/// # Arguments
///
/// * `own_pid` the process id of the calling (Bitwarden) process. Windows owned by this process are
///   never recorded.
///
/// # Errors
///
/// This function returns an `anyhow::Error` if the tracking thread cannot be
/// started. Detailed reasons will vary based on platform implementation.
pub fn start_foreground_tracking(own_pid: u32) -> Result<()> {
    windowing::start_foreground_tracking(own_pid)
}

/// Stops tracking the foreground window.
///
/// # Errors
///
/// This function returns an `anyhow::Error` if the tracking thread cannot be
/// stopped cleanly.
pub fn stop_foreground_tracking() -> Result<()> {
    windowing::stop_foreground_tracking()
}

/// Restores focus to the last recorded foreground window so that subsequent
/// [`type_input`] calls land in the application the user was previously working in.
///
/// # Errors
///
/// This function returns an `anyhow::Error` if no window has been recorded yet or
/// the recorded window can no longer be focused.
pub fn focus_last_window() -> Result<()> {
    windowing::focus_last_window()
}
