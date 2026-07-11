use anyhow::Result;
use serde::{Deserialize, Serialize};

/// RSS 条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssItem {
    pub guid: String,
    pub title: String,
    pub link: String,
    pub description: String,
    pub torrent_url: Option<String>,
    pub magnet_link: Option<String>,
    pub content_length: Option<i64>,
    pub pub_date: Option<String>,
}

/// RSS 解析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssFeed {
    pub title: String,
    pub link: String,
    pub description: String,
    pub items: Vec<RssItem>,
}

/// 从 RSS XML 中提取磁力链接
fn extract_magnet(text: &str) -> Option<String> {
    // 查找 magnet:?xt=... 链接
    let lower = text.to_lowercase();
    if let Some(start) = lower.find("magnet:?xt=") {
        let slice = &text[start..];
        // 磁力链接以 & 或空格或引号结束
        let end = slice.find(|c: char| c == '"' || c == '\'' || c.is_whitespace()).unwrap_or(slice.len());
        let magnet = &slice[..end];
        // 解码 HTML 实体
        let magnet = magnet.replace("&amp;", "&");
        Some(magnet.to_string())
    } else {
        None
    }
}

/// 解析 Mikanani RSS XML
pub fn parse_mikanani_rss(xml: &str) -> Result<RssFeed> {
    let mut feed = RssFeed {
        title: String::new(),
        link: String::new(),
        description: String::new(),
        items: Vec::new(),
    };

    // 简单的 XML 解析（不依赖重量级 XML 库）
    // 提取 channel 信息
    if let Some(title_start) = xml.find("<title>") {
        if let Some(title_end) = xml[title_start..].find("</title>") {
            feed.title = xml[title_start + 7..title_start + title_end].to_string();
        }
    }
    if let Some(link_start) = xml.find("<channel>\n<link>") {
        if let Some(link_end) = xml[link_start..].find("</link>") {
            feed.link = xml[link_start + 15..link_start + link_end].to_string();
        }
    }

    // 提取每个 item
    let mut pos = 0;
    while let Some(item_start) = xml[pos..].find("<item>") {
        let item_start = pos + item_start;
        if let Some(item_end) = xml[item_start..].find("</item>") {
            let item_xml = &xml[item_start..item_start + item_end + 7];
            
            let mut item = RssItem {
                guid: String::new(),
                title: String::new(),
                link: String::new(),
                description: String::new(),
                torrent_url: None,
                magnet_link: None,
                content_length: None,
                pub_date: None,
            };

            // 提取 guid
            if let Some(g_start) = item_xml.find("<guid") {
                if let Some(g_end) = item_xml[g_start..].find("</guid>") {
                    let guid_text = &item_xml[g_start..g_start + g_end + 7];
                    // 去掉标签，只保留文本
                    if let Some(text_start) = guid_text.find('>') {
                        item.guid = guid_text[text_start + 1..guid_text.len() - 7].trim().to_string();
                    }
                }
            }

            // 提取 title
            if let Some(t_start) = item_xml.find("<title>") {
                if let Some(t_end) = item_xml[t_start..].find("</title>") {
                    item.title = item_xml[t_start + 7..t_start + t_end].trim().to_string();
                }
            }

            // 提取 link
            if let Some(l_start) = item_xml.find("<link>") {
                if let Some(l_end) = item_xml[l_start..].find("</link>") {
                    item.link = item_xml[l_start + 6..l_start + l_end].trim().to_string();
                }
            }

            // 提取 description
            if let Some(d_start) = item_xml.find("<description>") {
                if let Some(d_end) = item_xml[d_start..].find("</description>") {
                    item.description = item_xml[d_start + 13..d_start + d_end].trim().to_string();
                }
            }

            // 提取 torrent URL (enclosure)
            if let Some(e_start) = item_xml.find("<enclosure") {
                if let Some(e_end) = item_xml[e_start..].find("/>") {
                    let enclosure = &item_xml[e_start..e_start + e_end + 2];
                    // 提取 url="..."
                    if let Some(url_start) = enclosure.find("url=\"") {
                        let url_text = &enclosure[url_start + 5..];
                        if let Some(url_end) = url_text.find('"') {
                            item.torrent_url = Some(url_text[..url_end].to_string());
                        }
                    }
                }
            }

            // 提取 contentLength
            if let Some(cl_start) = item_xml.find("<contentLength>") {
                if let Some(cl_end) = item_xml[cl_start..].find("</contentLength>") {
                    let cl_text = item_xml[cl_start + 15..cl_start + cl_end].trim();
                    item.content_length = cl_text.parse::<i64>().ok();
                }
            }

            // 提取 pubDate
            if let Some(pd_start) = item_xml.find("<pubDate>") {
                if let Some(pd_end) = item_xml[pd_start..].find("</pubDate>") {
                    item.pub_date = Some(item_xml[pd_start + 9..pd_start + pd_end].trim().to_string());
                }
            }

            // 从整个 item XML 中提取磁力链接
            item.magnet_link = extract_magnet(item_xml);

            // 如果没有磁力链接，从 description 中尝试提取
            if item.magnet_link.is_none() {
                item.magnet_link = extract_magnet(&item.description);
            }

            if !item.guid.is_empty() || !item.title.is_empty() {
                feed.items.push(item);
            }

            pos = item_start + item_end + 7;
        } else {
            break;
        }
    }

    Ok(feed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_mikanani_rss() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>Mikan Project - Test</title>
<link>https://mikanani.kas.pub/RSS/Bangumi?bangumiId=4042</link>
<description>Test</description>
<item><guid isPermaLink="false">[ANi] Test - 02 [1080P]</guid>
<link>https://mikanani.kas.pub/Home/Episode/abc123</link>
<title>[ANi] Test - 02 [1080P][Baha][AAC AVC][CHT][MP4]</title>
<description>[ANi] Test - 02 [1080P][510.1 MB]</description>
<torrent xmlns="https://mikanani.kas.pub/0.1/"><contentLength>534878624</contentLength><pubDate>2026-07-11T00:31:36</pubDate></torrent>
<enclosure type="application/x-bittorrent" length="534878624" url="https://mikanani.kas.pub/Download/test.torrent" /></item>
</channel></rss>"#;

        let feed = parse_mikanani_rss(xml).unwrap();
        assert_eq!(feed.title, "Mikan Project - Test");
        assert_eq!(feed.items.len(), 1);
        assert_eq!(feed.items[0].title, "[ANi] Test - 02 [1080P][Baha][AAC AVC][CHT][MP4]");
        assert!(feed.items[0].torrent_url.is_some());
        assert_eq!(feed.items[0].content_length, Some(534878624));
    }
}
