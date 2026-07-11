use std::collections::{HashMap, HashSet};

/// 关键词类别
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum KeywordCategory {
    SubtitleGroup,  // 字幕组
    Resolution,     // 画质
    Codec,          // 编码
    Audio,          // 音频
    Language,       // 语言
    Source,         // 来源
    Container,      // 容器格式
}

impl KeywordCategory {
    pub fn display_name(&self) -> &str {
        match self {
            Self::SubtitleGroup => "字幕组",
            Self::Resolution => "画质",
            Self::Codec => "编码",
            Self::Audio => "音频",
            Self::Language => "语言",
            Self::Source => "来源",
            Self::Container => "容器",
        }
    }
}

/// 从标题中提取的关键词
#[derive(Debug, Clone)]
pub struct ExtractedKeyword {
    pub category: KeywordCategory,
    pub value: String,
}

/// 从 RSS 标题中提取关键词
/// 
/// 标题格式示例:
/// `[ANi] 从后面来的神威先生 - 02 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]`
/// `[黒ネズミたち] 从后面来的神威先生 - 02 (Baha 1920x1080 AVC AAC MP4)`
pub fn extract_keywords(titles: &[String]) -> HashMap<KeywordCategory, Vec<String>> {
    let mut result: HashMap<KeywordCategory, HashSet<String>> = HashMap::new();

    for title in titles {
        let extracted = extract_keywords_from_title(title);
        for kw in extracted {
            result.entry(kw.category).or_default().insert(kw.value);
        }
    }

    // 转换为排序后的 Vec
    result.into_iter()
        .map(|(cat, vals)| (cat, {
            let mut v: Vec<String> = vals.into_iter().collect();
            v.sort();
            v
        }))
        .collect()
}

/// 从单个标题提取关键词
fn extract_keywords_from_title(title: &str) -> Vec<ExtractedKeyword> {
    let mut keywords = Vec::new();

    // 1. 提取字幕组（第一个 [...] 中的内容）
    if title.starts_with('[') {
        if let Some(end) = title.find(']') {
            let group = &title[1..end];
            if !group.is_empty() {
                keywords.push(ExtractedKeyword {
                    category: KeywordCategory::SubtitleGroup,
                    value: group.to_string(),
                });
            }
        }
    }

    // 2. 提取方括号中的关键词
    let mut pos = 0;
    while let Some(start) = title[pos..].find('[') {
        let start = pos + start;
        if let Some(end) = title[start..].find(']') {
            let content = &title[start + 1..start + end];
            pos = start + end + 1;

            if content.is_empty() {
                continue;
            }

            // 画质
            if is_resolution(content) {
                keywords.push(ExtractedKeyword {
                    category: KeywordCategory::Resolution,
                    value: normalize_resolution(content),
                });
                continue;
            }

            // 编码
            if is_codec(content) {
                keywords.push(ExtractedKeyword {
                    category: KeywordCategory::Codec,
                    value: content.to_string(),
                });
                continue;
            }

            // 音频
            if is_audio(content) {
                keywords.push(ExtractedKeyword {
                    category: KeywordCategory::Audio,
                    value: content.to_string(),
                });
                continue;
            }

            // 语言
            if is_language(content) {
                keywords.push(ExtractedKeyword {
                    category: KeywordCategory::Language,
                    value: content.to_string(),
                });
                continue;
            }

            // 来源
            if is_source(content) {
                keywords.push(ExtractedKeyword {
                    category: KeywordCategory::Source,
                    value: content.to_string(),
                });
                continue;
            }

            // 容器格式
            if is_container(content) {
                keywords.push(ExtractedKeyword {
                    category: KeywordCategory::Container,
                    value: content.to_uppercase(),
                });
                continue;
            }
        } else {
            break;
        }
    }

    // 3. 提取圆括号中的关键词（某些字幕组用圆括号）
    let mut pos = 0;
    while let Some(start) = title[pos..].find('(') {
        let start = pos + start;
        if let Some(end) = title[start..].find(')') {
            let content = &title[start + 1..start + end];
            pos = start + end + 1;

            // 来源（如 Baha, ABEMA）
            if is_source(content) {
                keywords.push(ExtractedKeyword {
                    category: KeywordCategory::Source,
                    value: content.trim().to_string(),
                });
            }

            // 画质（如 1920x1080）
            if content.contains('x') && content.chars().any(|c| c.is_numeric()) {
                let resolution = normalize_resolution(content);
                if !resolution.is_empty() {
                    keywords.push(ExtractedKeyword {
                        category: KeywordCategory::Resolution,
                        value: resolution,
                    });
                }
            }
        } else {
            break;
        }
    }

    keywords
}

fn is_resolution(s: &str) -> bool {
    matches!(s.to_uppercase().as_str(), 
        "4K" | "2160P" | "1440P" | "1080P" | "720P" | "480P" | "360P" | "HDR" | "HDR10" | "DOLBY VISION" | "DV")
        || s.contains("x") && s.chars().any(|c| c.is_numeric())
}

fn normalize_resolution(s: &str) -> String {
    let upper = s.to_uppercase();
    match upper.as_str() {
        "4K" | "2160P" => "4K".to_string(),
        "1440P" => "2K".to_string(),
        "1080P" => "1080P".to_string(),
        "720P" => "720P".to_string(),
        "480P" => "480P".to_string(),
        _ => {
            // 尝试解析 WxH 格式
            if let Some(pos) = s.find('x') {
                if let (Ok(w), Ok(h)) = (s[..pos].trim().parse::<u32>(), s[pos + 1..].trim().parse::<u32>()) {
                    if h >= 2160 { "4K".to_string() }
                    else if h >= 1440 { "2K".to_string() }
                    else if h >= 1080 { "1080P".to_string() }
                    else if h >= 720 { "720P".to_string() }
                    else { format!("{}x{}", w, h) }
                } else {
                    s.to_string()
                }
            } else {
                s.to_string()
            }
        }
    }
}

fn is_codec(s: &str) -> bool {
    matches!(s.to_uppercase().as_str(), "AVC" | "H264" | "H.264" | "HEVC" | "H265" | "H.265" | "X264" | "X265" | "AV1" | "VP9" | "AAC" | "FLAC" | "DTS" | "AC3" | "EAC3" | "OPUS")
}

fn is_audio(s: &str) -> bool {
    matches!(s.to_uppercase().as_str(), "AAC" | "FLAC" | "DTS" | "DTS-HD" | "TRUEHD" | "AC3" | "EAC3" | "OPUS" | "MP3" | "PCM" | "LPCM")
}

fn is_language(s: &str) -> bool {
    matches!(s.to_uppercase().as_str(), "CHT" | "CHS" | "JAP" | "JPN" | "ENG" | "多国" | "简中" | "繁中" | "日语" | "英语" | "中文字幕" | "双语")
}

fn is_source(s: &str) -> bool {
    matches!(s.to_uppercase().as_str(), "BAHA" | "ABEMA" | "BILIBILI" | "B站" | "CR" | "CRUNCHYROLL" | "NF" | "NETFLIX" | "AMZN" | "AMAZON" | "WEB-DL" | "WEBRIP" | "BLU-RAY" | "BDRIP" | "HDTV" | "TV-RIP" | "RAW")
}

fn is_container(s: &str) -> bool {
    matches!(s.to_uppercase().as_str(), "MP4" | "MKV" | "AVI" | "MOV" | "WEBM" | "TS" | "FLV")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_keywords() {
        let titles = vec![
            "[ANi] Test Anime - 01 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]".to_string(),
            "[ANi] Test Anime - 02 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]".to_string(),
            "[黒ネズミたち] Test Anime - 01 (Baha 1920x1080 AVC AAC MP4)".to_string(),
        ];

        let keywords = extract_keywords(&titles);
        
        // 字幕组
        let groups = keywords.get(&KeywordCategory::SubtitleGroup).unwrap();
        assert!(groups.contains(&"ANi".to_string()));
        assert!(groups.contains(&"黒ネズミたち".to_string()));

        // 画质
        let resolutions = keywords.get(&KeywordCategory::Resolution).unwrap();
        assert!(resolutions.contains(&"1080P".to_string()));
    }
}
