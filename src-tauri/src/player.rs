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
        
        // 配置 OSD
        mpv.set_property("osd-level", 1)?;
        mpv.set_property("osd-duration", 2000)?;
        
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

    pub fn seek_relative(&self, offset: f64) -> Result<()> {
        self.mpv.command("seek", &[&offset.to_string(), "relative"])?;
        Ok(())
    }

    pub fn set_speed(&self, speed: f64) -> Result<()> {
        self.mpv.set_property("speed", speed)?;
        Ok(())
    }

    pub fn get_speed(&self) -> Result<f64> {
        let speed: f64 = self.mpv.get_property("speed")?;
        Ok(speed)
    }

    pub fn set_volume(&self, volume: i64) -> Result<()> {
        self.mpv.set_property("volume", volume)?;
        Ok(())
    }

    pub fn get_volume(&self) -> Result<i64> {
        let volume: i64 = self.mpv.get_property("volume")?;
        Ok(volume)
    }

    pub fn get_position(&self) -> Result<f64> {
        let pos: f64 = self.mpv.get_property("time-pos")?;
        Ok(pos)
    }

    pub fn get_duration(&self) -> Result<f64> {
        let duration: f64 = self.mpv.get_property("duration")?;
        Ok(duration)
    }

    pub fn is_paused(&self) -> Result<bool> {
        let paused: bool = self.mpv.get_property("pause")?;
        Ok(paused)
    }

    pub fn load_subtitle(&self, path: &str) -> Result<()> {
        self.mpv.command("sub-add", &[path])?;
        Ok(())
    }

    pub fn set_subtitle(&self, index: i64) -> Result<()> {
        self.mpv.set_property("sub", index)?;
        Ok(())
    }

    pub fn get_subtitle_list(&self) -> Result<Vec<SubtitleInfo>> {
        let count: i64 = self.mpv.get_property("sub-count")?;
        let mut subtitles = Vec::new();
        
        for i in 0..count {
            let title: String = self.mpv.get_property(&format!("sub/{}/title", i))
                .unwrap_or_default();
            let lang: String = self.mpv.get_property(&format!("sub/{}/lang", i))
                .unwrap_or_default();
            
            subtitles.push(SubtitleInfo {
                index: i,
                title,
                lang,
            });
        }
        
        Ok(subtitles)
    }

    pub fn set_fullscreen(&self, fullscreen: bool) -> Result<()> {
        self.mpv.set_property("fullscreen", fullscreen)?;
        Ok(())
    }

    pub fn toggle_fullscreen(&self) -> Result<()> {
        let fullscreen: bool = self.mpv.get_property("fullscreen")?;
        self.mpv.set_property("fullscreen", !fullscreen)?;
        Ok(())
    }

    pub fn set_aspect_ratio(&self, ratio: &str) -> Result<()> {
        self.mpv.set_property("video-aspect-override", ratio)?;
        Ok(())
    }

    pub fn get_aspect_ratio(&self) -> Result<String> {
        let ratio: String = self.mpv.get_property("video-aspect-override")?;
        Ok(ratio)
    }

    pub fn set_video_track(&self, track: i64) -> Result<()> {
        self.mpv.set_property("vid", track)?;
        Ok(())
    }

    pub fn set_audio_track(&self, track: i64) -> Result<()> {
        self.mpv.set_property("aid", track)?;
        Ok(())
    }

    pub fn get_video_tracks(&self) -> Result<Vec<TrackInfo>> {
        let count: i64 = self.mpv.get_property("track-list/count")?;
        let mut tracks = Vec::new();
        
        for i in 0..count {
            let track_type: String = self.mpv.get_property(&format!("track-list/{}/type", i))
                .unwrap_or_default();
            
            if track_type == "video" {
                let id: i64 = self.mpv.get_property(&format!("track-list/{}/id", i))
                    .unwrap_or_default();
                let title: String = self.mpv.get_property(&format!("track-list/{}/title", i))
                    .unwrap_or_default();
                let codec: String = self.mpv.get_property(&format!("track-list/{}/codec", i))
                    .unwrap_or_default();
                let width: i64 = self.mpv.get_property(&format!("track-list/{}/demux-w", i))
                    .unwrap_or_default();
                let height: i64 = self.mpv.get_property(&format!("track-list/{}/demux-h", i))
                    .unwrap_or_default();
                
                tracks.push(TrackInfo {
                    id,
                    title,
                    codec,
                    width: Some(width),
                    height: Some(height),
                });
            }
        }
        
        Ok(tracks)
    }

    pub fn get_audio_tracks(&self) -> Result<Vec<TrackInfo>> {
        let count: i64 = self.mpv.get_property("track-list/count")?;
        let mut tracks = Vec::new();
        
        for i in 0..count {
            let track_type: String = self.mpv.get_property(&format!("track-list/{}/type", i))
                .unwrap_or_default();
            
            if track_type == "audio" {
                let id: i64 = self.mpv.get_property(&format!("track-list/{}/id", i))
                    .unwrap_or_default();
                let title: String = self.mpv.get_property(&format!("track-list/{}/title", i))
                    .unwrap_or_default();
                let codec: String = self.mpv.get_property(&format!("track-list/{}/codec", i))
                    .unwrap_or_default();
                
                tracks.push(TrackInfo {
                    id,
                    title,
                    codec,
                    width: None,
                    height: None,
                });
            }
        }
        
        Ok(tracks)
    }

    pub fn screenshot(&self, path: &str) -> Result<()> {
        self.mpv.command("screenshot-to-file", &[path])?;
        Ok(())
    }

    pub fn stop(&self) -> Result<()> {
        self.mpv.command("stop", &[])?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct SubtitleInfo {
    pub index: i64,
    pub title: String,
    pub lang: String,
}

#[derive(Debug, Clone)]
pub struct TrackInfo {
    pub id: i64,
    pub title: String,
    pub codec: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

// 播放视频
pub fn play(path: &str) -> Result<()> {
    let mut player = VideoPlayer::new()?;
    player.load(path)?;
    player.play()?;
    Ok(())
}
