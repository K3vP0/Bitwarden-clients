#[napi]
pub mod autotype {
    #[napi]
    pub fn get_foreground_window_title() -> napi::Result<String> {
        Ok(autotype::get_foreground_window_title()?)
    }

    #[napi]
    pub fn type_input(
        input: Vec<u16>,
        keyboard_shortcut: Vec<String>,
    ) -> napi::Result<(), napi::Status> {
        Ok(autotype::type_input(&input, &keyboard_shortcut)?)
    }

    /// Starts tracking the most recent foreground window that does not belong to
    /// the Bitwarden process, so autotype can be triggered from the Bitwarden UI
    /// and still restore focus to the application the user was working in.
    #[napi]
    pub fn start_foreground_tracking(own_pid: u32) -> napi::Result<(), napi::Status> {
        Ok(autotype::start_foreground_tracking(own_pid)?)
    }

    /// Stops tracking the foreground window.
    #[napi]
    pub fn stop_foreground_tracking() -> napi::Result<(), napi::Status> {
        Ok(autotype::stop_foreground_tracking()?)
    }

    /// Restores focus to the last recorded foreground window so that a subsequent
    /// `type_input` call lands in that window.
    #[napi]
    pub fn focus_last_window() -> napi::Result<(), napi::Status> {
        Ok(autotype::focus_last_window()?)
    }
}
