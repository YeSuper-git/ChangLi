use anyhow::Result;
use libmpv::{Mpv, events::*};

pub struct VideoPlayer {
    mpv: Mpv,
    current_file: Option<String>,
}

impl VideoPlayer {
    pub fn new() -> Result<Self> {
        let mpv = Mpv::new()?;
        
        // 配置硬件解码
        mpv.set_property("hwdec", "auto")?;
        
        // 配置视频同步
        mpv.set_property("video-sync", "display-resample")?;
        
        // 配置音频输出
        mpv.set_property("audio-pull-mode", "yes")?;
        
        Ok(Self {
            mpv,
            current_file: None,
        })
    }

    pub fn load(&mut self, path: &str) -> Result<()> {
        self.mpv.command("loadfile", &[path])?;
        self.current_file = Some(path.to_string());
        Ok(())
    }

    pub fn play(&self) -> Result<()> {
        self.mpv.set_property("pause", false)?;
        Ok(())
    }

    pub fn pause(&self) -> Result<()> {
        self.mpv.set_property("pause", true)?;
        Ok(())
    }

    pub fn toggle_pause(&self) -> Result<()> {
        let paused: bool = self.mpv.get_property("pause")?;
        self.mpv.set_property("pause", !paused)?;
        Ok(())
    }

    pub fn seek(&self, position: f64) -> Result<()> {
        self.mpv.command("seek", &[&position.to_string(), "absolute"])?;
        Ok(())
    }

    pub fn set_speed(&self, speed: f64) -> Result<()> {
        self.mpv.set_property("speed", speed)?;
        Ok(())
    }

    pub fn set_volume(&self, volume: i64) -> Result<()> {
        self.mpv.set_property("volume", volume)?;
        Ok(())
    }

    pub fn get_position(&self) -> Result<f64> {
        let pos: f64 = self.mpv.get_property("time-pos")?;
        Ok(pos)
    }

    pub fn get_duration(&self) -> Result<f64> {
        let duration: f64 = self.mpv.get_property("duration")?;
        Ok(duration)
    }

    pub fn get_volume(&self) -> Result<i64> {
        let volume: i64 = self.mpv.get_property("volume")?;
        Ok(volume)
    }

    pub fn is_paused(&self) -> Result<bool> {
        let paused: bool = self.mpv.get_property("pause")?;
        Ok(paused)
    }

    pub fn load_subtitle(&self, path: &str) -> Result<()> {
        self.mpv.command("sub-add", &[path])?;
        Ok(())
    }

    pub fn set_fullscreen(&self, fullscreen: bool) -> Result<()> {
        self.mpv.set_property("fullscreen", fullscreen)?;
        Ok(())
    }
}

// 播放视频
pub fn play(path: &str) -> Result<()> {
    let mut player = VideoPlayer::new()?;
    player.load(path)?;
    player.play()?;
    Ok(())
}
