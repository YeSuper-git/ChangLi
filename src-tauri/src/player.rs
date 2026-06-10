use anyhow::Result;

// 简化版播放器 - 使用系统默认播放器
pub struct VideoPlayer {
    current_file: Option<String>,
}

impl VideoPlayer {
    pub fn new() -> Result<Self> {
        Ok(Self {
            current_file: None,
        })
    }

    pub fn load(&mut self, path: &str) -> Result<()> {
        self.current_file = Some(path.to_string());
        Ok(())
    }

    pub fn play(&self) -> Result<()> {
        if let Some(path) = &self.current_file {
            // 使用系统默认播放器打开文件
            open::that(path)?;
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<()> {
        // 系统播放器无法直接停止
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
